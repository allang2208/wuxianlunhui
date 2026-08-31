"""Create an offline alignment illustration, not a game/runtime check."""
from pathlib import Path
import importlib.util
import json
from PIL import Image, ImageDraw, ImageOps

root = Path(__file__).resolve().parent
game = root.parents[2]
meta = json.loads((root / 'hybrid-manifest.json').read_text())
spec = importlib.util.spec_from_file_location('hybrid', root / 'build-hybrid.py')
hybrid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hybrid)
sheet = Image.open(root / 'sheets/foreman-whip-hybrid-candidate.png').convert('RGBA')
idle = Image.open(game / 'assets/enemies/foreman_zombie/idle.png').convert('RGBA').crop((0,0,512,512))
fw, fh = meta['frameWidth'], meta['frameHeight']
scale = 480/512

def candidate(index):
    return sheet.crop((index%6*fw,index//6*fh,index%6*fw+fw,index//6*fh+fh))

def panel(actor, ax, ay, mirror, label, contact=False):
    image = Image.new('RGB', (760,340), '#303740')
    draw = ImageDraw.Draw(image)
    rx, ry = (410 if mirror else 320), 290
    rendered = actor.resize((round(actor.width*scale),round(actor.height*scale)),Image.Resampling.LANCZOS)
    anchor = actor.width-ax if mirror else ax
    if mirror: rendered=ImageOps.mirror(rendered)
    image.paste(rendered,(round(rx-anchor*scale),round(ry-ay*scale)),rendered)
    draw.line((20,ry,740,ry),fill='#58b7c5')
    draw.line((rx,25,rx,315),fill='#caa15e')
    draw.text((15,12),label,fill='white')
    draw.text((15,317),'scaleX = scaleY = 0.9375; fixed anchor; no per-frame centering',fill='white')
    if contact:
        sign=-1 if mirror else 1
        tipx=rx+sign*320
        tipy=ry+(hybrid.whip_points(9)[-1][1]-hybrid.FOOT_Y)*scale
        draw.line((tipx,tipy,tipx,ry),fill='#caa15e',width=1)
        draw.line((rx,ry+11,tipx,ry+11),fill='#f3d684',width=2)
        draw.ellipse((tipx-4,tipy-4,tipx+4,tipy+4),outline='#f3d684',width=2)
        draw.text(((rx+tipx)/2-35,ry+16),'320 px',fill='#f3d684')
    return image

proof=Image.new('RGB',(1520,1020),'#303740')
items=[(idle,256,414,False,'OLD idle: fixed 512 reference'),
       (candidate(0),meta['footX'],meta['footY'],False,'NEW f0: corrected support anchor'),
       (candidate(36),meta['footX'],meta['footY'],False,'NEW f36: 870.9677 ms / right contact',True),
       (candidate(36),meta['footX'],meta['footY'],True,'NEW f36: 870.9677 ms / left contact',True),
       (candidate(60),meta['footX'],meta['footY'],False,'NEW f60: natural recovery pose retained'),
       (candidate(0),meta['footX'],meta['footY'],True,'NEW f0: mirrored fixed anchor')]
for i,args in enumerate(items): proof.paste(panel(*args),(i%2*760,i//2*340))
proof.save(root/'previews/alignment-corrected.png')

# This file is an integration specification only; it is not imported by game code.
contract={
    'status':'candidate_geometry_corrected_not_integrated',
    'referenceCell':512,'displaySize':480,'pixelScaleX':scale,'pixelScaleY':scale,
    'candidateLayout':{k:meta[k] for k in ['frameWidth','frameHeight','frameCount','endFrame','cols','rows','footX','footY','frameDurations']},
    'candidateDisplayWidth':fw*scale,'candidateDisplayHeight':fh*scale,
    'spriteSizeOption':max(fw,fh)*scale,
    'range':320,'width':26,'durationMs':1500,'contactFrame':36,'contactMs':meta['contactPoseMs'],
    'soundFrame':30,'soundMs':meta['soundMs'],
    'colliderOffsets':{'x':6,'y':-20},
    'candidateFootOffsetYAtCollider':(meta['footY']-fh/2)*scale+20,
    'oldFootOffsetYAtCollider':(414-256)*scale+20,
    'frameAnchorFormula':'layout.footX - colliderOffsetX / pixelScale * (flipX ? -1 : 1)',
    'footOffsetFormula':'(layout.footY - layout.frameHeight / 2) * pixelScale - colliderOffsetY',
    'bodyPolicy':'fixed scale and fixed action anchor, no per-frame fit or recenter',
    'currentRuntimeMismatches':[
        'Boot still loads the OLD 512x512/31-frame attack; candidate not installed',
        'Current render footOffsetY=148 aligns old soles near entity.y, not collider.y=entity.y-20',
        'Current flipX follows live target during an attack while the hit rectangle keeps its locked direction',
        'Current damage dt and Phaser attack animation run on independent clocks',
        'Baked left/right whip cannot represent vertical/diagonal ground-directed hit rectangles',
        'Existing _fireWhipArc adds a second long whip and must not remain unchanged'
    ]
}
(root/'alignment-integration-contract.json').write_text(json.dumps(contract,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in contract.items() if k!='candidateLayout'}))
