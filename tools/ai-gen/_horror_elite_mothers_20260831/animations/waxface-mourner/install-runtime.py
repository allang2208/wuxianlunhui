"""Install the reviewed mourner only; preserve unrelated concurrent content."""
from pathlib import Path
import copy
import json
import re

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
BUILD = ROOT/'sprite-build-v01'
STATES = {'idle':'idle','walking':'walk','attacking':'attack','dying':'death'}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def edit(path, old, new):
    content = path.read_text(encoding='utf-8')
    if new in content: return
    if content.count(old) != 1: raise RuntimeError(f'Ambiguous edit: {path}')
    path.write_text(content.replace(old, new, 1), encoding='utf-8')


def install():
    manifest = json.loads((BUILD/'manifest.json').read_text(encoding='utf-8'))
    configs = json.loads((REPO/'data/enemy-config.json').read_text(encoding='utf-8'))
    cfg = copy.deepcopy(configs['ossuaryCaster'])
    cfg.update(id='waxfaceMourner', name='蜡面哀祷者', type='精英', rank='elite', level=6,
        hp=560, maxHp=560, speed=115, str=12, dex=18, con=28, int=46, wis=30, luck=8,
        color='#aa927c', basicMeleeResolver=False, attackRange=420, attackDistance=420,
        description='恐怖地牢专属精英。单手托蜡碗，出掌时在原目标脚下留下固定蜡印；900毫秒后爆发一次魔法伤害并减速。预警期间走出圈、遮挡或换层可躲避；无追踪、持续伤害或召唤。',
        attackType='魔法（固定落点封蜡诅咒）')
    attack = next(r for r in manifest['actions'] if r['action']=='attacking')
    cfg['attack'] = dict(type='thrust', cooldown=4200, range=420, dynamicRange=420, width=0, knockback=0)
    cfg['attackSkills'] = {'primary': dict(range=420, radius=72, damageMul=1.4, knockback=0,
        cooldown=4200, initialCooldownMs=900, duration=1500, frames=attack['frameCount'],
        eventFrame=attack['contactFrame'], eventMs=attack['contactMs'], sourceEventFrame=47,
        warningMs=900, burstVisualMs=350, slowReduction=.2, slowDurationMs=2000, behindTolerance=24,
        comment='源片f47伸掌对应正式0-based第34帧725ms；起手锁目标/方向，出手锁落点，900ms预警后一次爆发。动画和释放消费同一逐帧时间表；已释放蜡印独立于施法者死亡。')}
    scale = manifest['calibration']['runtimeBodyHeightPx']/manifest['calibration']['preparedBodyHeightPx']
    cfg['render'].update(spriteSize=256*scale, bodyDisplayHeight=manifest['calibration']['runtimeBodyHeightPx'])
    cfg['death'] = dict(animMs=next(r['durationMs'] for r in manifest['actions'] if r['action']=='dying'), holdMs=1000, fadeMs=300)
    cfg['ai'].update(preferredCastRange=340, resumeChaseRange=390)
    cfg['skills'] = [dict(name='封蜡诅咒', desc='追至地面距离340停步施法，超过390或失去视线再追击。出生首次冷却0.9秒；施法1.5秒，第34帧725ms释放固定蜡印，预警900ms后对半径72内同层目标造成魔攻×1.4伤害；受伤者减速20%持续2秒，重复只刷新。释放射程420，冷却4.2秒从起手计算，收招后在射程内原地等冷却。控制/死亡取消未释放动作，已释放蜡印独立结算。')]
    textures = {'referenceCell':256, 'frameLayouts':{}}
    for r in manifest['actions']:
        state = STATES[r['action']]
        target = f'assets/enemies/waxface_mourner/{state}.png'
        if (ROOT/r['sheet']).resolve() != (REPO/target).resolve():
            raise RuntimeError('Formal sprites must have one canonical runtime path')
        if not (REPO/target).exists(): raise FileNotFoundError(target)
        textures[state] = target
        textures['frameLayouts'][state] = dict(frameWidth=r['frameWidth'], frameHeight=r['frameHeight'],
            frameCount=r['frameCount'], endFrame=r['endFrame'], footX=r['footX'], footY=r['footY'],
            columns=r['cols'], rows=r['rows'], duration=r['durationMs'], frameRate=r['outputFps'],
            repeat=-1 if r['mode']=='loop' else 0, frameDurations=r['frameDurationsMs'])
    idle = textures['frameLayouts']['idle']
    textures.update(idleFrameWidth=idle['frameWidth'], idleFrameHeight=idle['frameHeight'],
        idleFrameCount=idle['frameCount'], idleSheetColumns=idle['columns'])
    cfg['textures'] = textures
    cfg['render']['footOffsetY'] = (idle['footY']-idle['frameHeight']/2)*scale
    write(BUILD/'runtime-config.json', cfg)
    for relative in ['data/enemy-config.json','public/data/enemy-config.json']:
        path = REPO/relative
        content = path.read_text(encoding='utf-8')
        existing = json.loads(content)
        if 'waxfaceMourner' in existing:
            if existing['waxfaceMourner'] != cfg: raise RuntimeError(f'Existing mourner differs: {path}')
            continue
        entry = json.dumps({'waxfaceMourner':cfg},ensure_ascii=False,indent=2)[2:-2]
        path.write_text(content.rstrip()[:-1].rstrip()+',\n'+entry+'\n}\n', encoding='utf-8')
    for relative in ['data/dungeon-config.json','public/data/dungeon-config.json']:
        path = REPO/relative
        content = path.read_text(encoding='utf-8')
        if '"waxfaceMourner"' in content: continue
        pattern = r'(?m)^( +)"stitchfaceHeadsman",$'
        if len(list(re.finditer(pattern,content))) != 8: raise RuntimeError(f'Horror pools changed: {path}')
        path.write_text(re.sub(pattern,lambda m:m[0]+'\n'+m[1]+'"waxfaceMourner",',content),encoding='utf-8')
    edit(REPO/'src/entities/enemy-types.js',
        "export { StitchfaceHeadsman } from './enemy-types/stitchface-headsman.js';",
        "export { StitchfaceHeadsman } from './enemy-types/stitchface-headsman.js';\nexport { WaxfaceMourner } from './enemy-types/waxface-mourner.js';")
    edit(REPO/'src/world/zombie-dungeon.js',
        "import { StitchfaceHeadsman } from '../entities/enemy-types/stitchface-headsman.js';",
        "import { StitchfaceHeadsman } from '../entities/enemy-types/stitchface-headsman.js';\nimport { WaxfaceMourner } from '../entities/enemy-types/waxface-mourner.js';")
    edit(REPO/'src/world/zombie-dungeon.js', 'export function createOssuaryCaster(x, y) {',
        "export function createWaxfaceMourner(x, y) {\n    return new WaxfaceMourner(x, y, { ai: { aggroRange: 9999, loseTimeout: 999999, alertRange: 9999 } });\n}\n\nexport function createOssuaryCaster(x, y) {")
    edit(REPO/'src/world/zombie-dungeon.js', '    stitchfaceHeadsman: createStitchfaceHeadsman,',
        '    stitchfaceHeadsman: createStitchfaceHeadsman,\n    waxfaceMourner: createWaxfaceMourner,')
    edit(REPO/'src/phaser/scenes/BootScene.js', "            ['stitchfaceHeadsman', 'stitchface_headsman'],",
        "            ['stitchfaceHeadsman', 'stitchface_headsman'],\n            ['waxfaceMourner', 'waxface_mourner'],")
    write(ROOT/'sprite-budget-manifest.json', dict(version=1,id='waxfaceMourner',profile='specialist',
        sheets=[dict(textureKey=r['textureKey'],path=textures[STATES[r['action']]],
            **{k:r[k] for k in ['frameWidth','frameHeight','frameCount','endFrame','footX','footY']}) for r in manifest['actions']], dependencies=[]))
    manifest.update(runtimeIntegrationActive=True, runtimeAcceptance='pending_user_test',
        delivery='../SPRITE_DELIVERY.md', profile='specialist', dependencies=[],
        camera=dict(normalZoom=1,maxNormalZoom=1.03,normalBodyPx=139.515234375,maxNormalBodyPx=139.515234375*1.03),
        producer=dict(script='../build-sprites.py',packing='../producer/sprite_packing.py',
            interpolation='../producer/rife-spritesheet-interpolate.py',version='rife-v4.6-rgba-v8-exact-half-step',
            defaultRebuild='original source-sheets -> one RIFE pass -> canonical runtime PNG and GIF'),
        combat=dict(releaseFrame=attack['contactFrame'],releaseMs=attack['contactMs'],warningMs=900,
            detonationMsFromActionStart=attack['contactMs']+900,radius=72,groundEllipse=[72,36],
            castRange=420,preferredCastRange=340,resumeChaseRange=390,initialCooldownMs=900,
            cooldownMs=4200,cooldownFrom='action_start',
            slowReduction=.2,slowDurationMs=2000,bodyVfxSeparated=True))
    write(BUILD/'manifest.json',manifest)
    write(BUILD/'runtime-installation.json',dict(id='waxfaceMourner',status='installed_pending_user_runtime_test',
        runtimeIntegrationActive=True,runtimeVerified=False,testsRun=False,rgbaMiB=manifest['rgbaMiB'],
        sourceManifest='manifest.json',runtimeFiles=[textures[s] for s in STATES.values()]))
    print('Installed mourner assets, config, loader and horror-only pools. No game tests run.')


if __name__=='__main__': install()
