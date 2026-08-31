"""Export the approved body poses and whip motion; update only the foreman config.

No models, browser, game, tests or build are started by this asset exporter.
The baked side-view candidate remains a reference; runtime uses body + whip.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import math
import re
import shutil
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
GAME = ROOT.parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply-runtime', action='store_true', help='Explicitly update the locally integrated game and both config copies.')
parser.add_argument('--body-sheet', type=Path, default=ROOT/'sheets/hybrid-body-rife.png')
parser.add_argument('--out-dir', type=Path, default=ROOT/'_rebuild')
args = parser.parse_args()
args.out_dir.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('hybrid', ROOT / 'build-hybrid.py')
hybrid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hybrid)

for relative in (['data/enemy-config.json', 'public/data/enemy-config.json',
                 'src/entities/enemy-types/foreman-zombie.js',
                 'src/phaser/scenes/BootScene.js', 'src/phaser/scenes/GameScene.js'] if args.apply_runtime else []):
    backup = ROOT / 'before-integration' / relative
    if not backup.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(GAME / relative, backup)

source = Image.open(args.body_sheet).convert('RGBA')
frames, boxes = [], []
for i in range(61):
    w,h = hybrid.W,hybrid.H
    frame = source.crop((i%6*w,i//6*h,i%6*w+w,i//6*h+h))
    if i in hybrid.BODY_SOURCE_FALLBACKS:
        index = hybrid.BODY_SOURCE_FALLBACKS[i]
        raw = np.asarray(Image.open(ROOT / f'source-inputs/whip-v04-optimized/{index:04d}.png').convert('RGBA'))
        frame = Image.fromarray(hybrid.transform_rgba(hybrid.actor_only(raw,index)))
    frames.append(frame)
    boxes.append(frame.getchannel('A').point(lambda a:255 if a>16 else 0).getbbox())
half = math.ceil((max(max(hybrid.FOOT_X-b[0],b[2]-hybrid.FOOT_X) for b in boxes)+8)/8)*8
top = math.floor((min(b[1] for b in boxes)-8)/8)*8
bottom = math.ceil((max(b[3] for b in boxes)+8)/8)*8
crop = (hybrid.FOOT_X-half,top,hybrid.FOOT_X+half,bottom)
fw,fh = half*2,bottom-top
choices = [(cols*math.ceil(61/cols),abs(cols*fw-math.ceil(61/cols)*fh),cols)
           for cols in range(1,62) if cols*fw<=4096 and math.ceil(61/cols)*fh<=4096]
cols = min(choices)[2]
rows = math.ceil(61/cols)
sheet = Image.new('RGBA',(fw*cols,fh*rows))
idle = Image.open(ROOT/'references/foreman-idle-master.png').convert('RGBA').crop((0,0,512,512))
idle_aligned = Image.new('RGBA',(fw,fh))
idle_aligned.paste(idle,(hybrid.STANCE_ANCHOR_X-crop[0]-256,hybrid.FOOT_Y-top-414))
whip_opacities=[]
for i,frame in enumerate(frames):
    # Short opacity transition to the existing idle. Fixed scale/root for both
    # layers; no pose morph, spatial interpolation or extra hold/event delay.
    weight = min(1,i/3,(60-i)/3)
    whip_opacities.append(weight)
    body = frame.crop(crop)
    if weight < 1:
        old = np.asarray(idle_aligned,dtype=np.float32)/255
        new = np.asarray(body,dtype=np.float32)/255
        alpha = old[:,:,3:]*(1-weight)+new[:,:,3:]*weight
        rgb = (old[:,:,:3]*old[:,:,3:]*(1-weight)+new[:,:,:3]*new[:,:,3:]*weight)/np.maximum(alpha,1e-8)
        body = Image.fromarray(np.uint8(np.clip(np.concatenate([rgb,alpha],axis=2)*255,0,255)))
    sheet.paste(body,(i%cols*fw,i//cols*fh))
asset = 'assets/enemies/foreman_zombie/attacking_doubao_body.png'
sheet.save(GAME / asset if args.apply_runtime else args.out_dir/'attacking_doubao_body.png')

# The old idle sheet had only one used cell. Preserve those pixels exactly.
idle_asset = 'assets/enemies/foreman_zombie/idle_single.png'
idle.save(GAME/idle_asset if args.apply_runtime else args.out_dir/'idle_single.png')
layout = {'frameWidth':fw,'frameHeight':fh,'frameCount':61,'endFrame':60,'cols':cols,'rows':rows,
          'footX':hybrid.STANCE_ANCHOR_X-crop[0],'footY':hybrid.FOOT_Y-top,
          'duration':1500,'frameDurations':hybrid.FRAME_DURATIONS,'repeat':0}
motion = {'referenceCell':512,'baseReach':320,'contactFrame':36,'soundFrame':30,
          'strokeWidths':[3.4*hybrid.SCALE,1.5*hybrid.SCALE],
          'whipOpacities':whip_opacities,
          'duration':1500,'frameDurations':hybrid.FRAME_DURATIONS,'layout':layout,'frames':[]}
for i in range(61):
    points = hybrid.whip_points(i/4)
    hand = points[0]
    indexes = np.rint(np.linspace(0,len(points)-1,33)).astype(int)
    motion['frames'].append({'hand':[round(float(hand[0]-hybrid.STANCE_ANCHOR_X),6),round(float(hand[1]-hybrid.FOOT_Y),6)],
                             'curve':[[round(float(x-hand[0]),6),round(float(y-hand[1]),6)] for x,y in points[indexes]]})
if not args.apply_runtime:
    (args.out_dir/'foreman-whip-motion.json').write_text(json.dumps(motion,separators=(',',':'))+'\n',encoding='utf-8')
    print(f'Exported retained assets to {args.out_dir}; game files unchanged.')
    raise SystemExit(0)
for relative in ['data/foreman-whip-motion.json','public/data/foreman-whip-motion.json']:
    (GAME/relative).write_text(json.dumps(motion,separators=(',',':'))+'\n',encoding='utf-8')

for relative in ['data/enemy-config.json','public/data/enemy-config.json']:
    path = GAME/relative
    text = path.read_bytes().decode('utf-8')
    match = re.search(r'"foremanZombie"\s*:\s*',text)
    start = match.end()
    cfg,length = json.JSONDecoder().raw_decode(text[start:])
    textures = cfg['textures']
    textures['idle'] = idle_asset
    textures['attack'] = asset
    textures['referenceCell'] = 512
    textures['idleSheetColumns'] = 1
    layouts = textures.setdefault('frameLayouts',{})
    for state,count,duration in [('idle',1,1000),('walk',20,2500),('howl',24,3000),('death',14,1400)]:
        layouts[state] = {'frameWidth':512,'frameHeight':512,'frameCount':count,'endFrame':count-1,
                          'footX':256,'footY':414,'duration':duration,'repeat':-1 if state in ['idle','walk'] else 0}
    layouts['attack'] = layout
    cfg['attackSkills']['whip'].update({'frames':61,'hitFrame':36,'width':26,
        'handHeight':-motion['frames'][36]['hand'][1]*cfg['render']['spriteSize']/512})
    cfg['sounds']['whipFrame'] = 30
    cfg['render']['footOffsetY'] = 168.125
    # Viewport footprint must include the independent whip, without enlarging
    # the Sprite or Collider. Only the foreman declares this optional radius.
    cfg['render']['visualCullRadius'] = 400
    for skill in cfg.get('skills',[]):
        if skill.get('name')=='鞭击':
            skill['desc']='锁定方向的单目标鞭击，射程320px、宽26px；1.5秒61帧，第36帧（约871ms）命中，物理攻击×2并附加1层流血（每层每秒1%当前生命值，持续10s，可叠加，到期减一层）；冷却4.5秒，攻击时不可移动，目标离开或被墙隔断则空挥。'
    replacement = json.dumps(cfg,ensure_ascii=False,indent=2).replace('\n','\n  ')
    path.write_bytes((text[:start]+replacement+text[start+length:]).encode('utf-8'))

cfg = json.loads((GAME/'data/enemy-config.json').read_text(encoding='utf-8'))['foremanZombie']
direct=[]
for state in ['idle','walk','attack','howl','death']:
    path=cfg['textures'][state]
    with Image.open(GAME/path) as image:
        direct.append({'state':state,'path':path,'size':list(image.size),'rgbaMiB':image.width*image.height*4/1048576})
manifest={'runtimeIntegrationActive':True,'assetOnly':False,'composition':'Doubao body + direction-projected independent whip',
          'bodySheet':asset,'idleSheet':idle_asset,'bodyCrop':crop,'layout':layout,'referenceCell':512,'displaySize':480,
          'sourceVideo':'videos/whip-v04.mp4','sourceProvenance':'videos/whip-v04.mp4.json',
          'bodySourceFallbacks':hybrid.BODY_SOURCE_FALLBACKS,'motionData':'data/foreman-whip-motion.json',
          'contactFrame':36,'contactMs':hybrid.CONTACT_MS,'soundFrame':30,'soundMs':sum(hybrid.FRAME_DURATIONS[:30]),
          'idleTransition':'Fixed-root opacity crossfade on frames 0-3 and 57-60; uses original idle pixels; whip opacity follows the same weights.',
          'directTextures':direct,'directRgbaMiB':sum(entry['rgbaMiB'] for entry in direct),
          'runtimeValidationPerformed':False,'dependencyBudget':'Existing mine-cave/summon dependency closure unchanged; not re-audited.'}
(ROOT/'runtime-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'layout':{k:v for k,v in layout.items() if k!='frameDurations'},'directRgbaMiB':manifest['directRgbaMiB']}))
