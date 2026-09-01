"""Assemble sword idle/walk grips and repair the local walking forearm return.

Offline asset authoring only. No game, browser, test, lint or build invocation.
The original shared walking sheets and approved running parts stay untouched.
"""
import argparse
import json
import math
import re
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FRAME = (512, 516)
CANVAS = (768, 560)
OFFSET = (128, 12)


def turn(point, pivot, root, angle):
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    x, y = point[0]-pivot[0], point[1]-pivot[1]
    return [root[0]+c*x-s*y, root[1]+s*x+c*y]


def place(image, pivot, root, angle, size=FRAME):
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    return image.transform(size, Image.Transform.AFFINE,
        (c, s, pivot[0]-c*root[0]-s*root[1], -s, c, pivot[1]+s*root[0]-c*root[1]),
        Image.Resampling.BICUBIC)


def repair_forearm(original, body, rig, index, wrist, hand_angle, hand_mask, source):
    repair = rig.get('loopRepair', {})
    elbow = repair.get('elbows', {}).get(str(index))
    if elbow is None:
        return body, wrist, hand_angle, 0
    weights = repair['weights']
    radius = len(weights)//2
    points = [rig['wrists'][(index+j-radius) % len(rig['wrists'])] for j in range(len(weights))]
    target = [sum(point[axis]*weight for point,weight in zip(points,weights))/sum(weights) for axis in (0,1)]
    dx,dy = wrist[0]-elbow[0], wrist[1]-elbow[1]
    length = math.hypot(dx,dy)
    delta = math.degrees(math.atan2(target[1]-elbow[1],target[0]-elbow[0])-math.atan2(dy,dx))
    # Source pixels rotate rigidly; never stretch the forearm or move the accepted fist alone.
    ux,uy = dx/length,dy/length
    polygon = [(elbow[0]+ux*t-uy*side*7,elbow[1]+uy*t+ux*side*7)
               for t,side in [(5,-1),(length+6,-1),(length+6,1),(5,1)]]
    mask = Image.new('L',FRAME)
    ImageDraw.Draw(mask).polygon(polygon,fill=255)
    part = original.copy()
    part.putalpha(ImageChops.multiply(original.getchannel('A'),mask))
    body.putalpha(ImageChops.multiply(body.getchannel('A'),ImageChops.invert(mask)))
    # Small intersection with the thigh is restored from the same frame's clean femur.
    if str(index) in rig['occludedThigh']:
        center,slope = rig['occludedThigh'][str(index)]
        corridor = Image.new('L',FRAME)
        ImageDraw.Draw(corridor).polygon([(center+slope*(yy-310)+side*7,yy)
            for yy,side in [(247,-1),(270,-1),(270,1),(247,1)]],fill=255)
        donor = original.transform(FRAME,Image.Transform.AFFINE,
            (1,-.7*slope,240*slope,0,.3,240),Image.Resampling.BICUBIC)
        body.paste(donor,(0,0),ImageChops.multiply(mask,corridor))
    donor_config = repair['pelvisDonor']
    offset = donor_config['offsets'].get(str(index))
    if offset:
        # Moving the arm exposes previously hidden pelvis pixels. Use the same walk's
        # unobscured frame 10, only inside the removed arm/hand; never copy legs or other arm.
        frame = donor_config['frame']
        crop = donor_config['crop']
        patch = source.crop((frame%8*512+crop[0],frame//8*516+crop[1],
                             frame%8*512+crop[2],frame//8*516+crop[3]))
        donor = Image.new('RGBA',FRAME)
        left,top = crop[0]+offset[0],crop[1]+offset[1]
        donor.alpha_composite(patch,(left,top))
        zone = Image.new('L',FRAME)
        ImageDraw.Draw(zone).rectangle((left,top,left+patch.width-1,top+patch.height-1),fill=255)
        body.paste(donor,(0,0),ImageChops.multiply(ImageChops.lighter(mask,hand_mask),zone))
    body.alpha_composite(place(part,elbow,elbow,delta))
    return body,turn(wrist,elbow,elbow,delta),hand_angle+delta,delta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish-config',action='store_true',help='Also update only sword.walkFrames in both JSON copies.')
    args = parser.parse_args()
    rig = json.loads((HERE/'rig.json').read_text(encoding='utf-8'))
    source = Image.open(ROOT/rig['source']).convert('RGBA')
    fist = Image.open(ROOT/rig['fistSource']).convert('RGBA').crop(rig['fistCrop'])
    fist = fist.resize(rig['fistSize'], Image.Resampling.LANCZOS)
    fist.save(HERE/'gripping-hand.png')
    pictures, hand_layers, palms, joints = [], [], [], []
    for i, (wrist, angle) in enumerate(zip(rig['wrists'], rig['handAngles'])):
        x, y = i%8*512, i//8*516
        original = source.crop((x, y, x+512, y+516))
        body = original.copy()
        mask = Image.new('L', FRAME)
        polygon = rig['handMasks'].get(str(i)) or [[wrist[0]+px,wrist[1]+py] for px,py in rig['openHandPolygon']]
        ImageDraw.Draw(mask).polygon([tuple(p) for p in polygon], fill=255)
        for edge in rig['edgeMasks'].get(str(i), []):
            ImageDraw.Draw(mask).polygon([tuple(p) for p in edge],fill=255)
        body.putalpha(ImageChops.multiply(body.getchannel('A'), ImageChops.invert(mask)))
        if str(i) in rig['occludedThigh']:
            # Reuse this very frame's unobscured lower femur, only inside the removed
            # hand mask. No authored joint, leg trajectory or pixels outside the mask move.
            center, slope = rig['occludedThigh'][str(i)]
            corridor = Image.new('L', FRAME)
            points = [(center+slope*(yy-310)+side*7,yy) for yy,side in [(252,-1),(312,-1),(312,1),(252,1)]]
            ImageDraw.Draw(corridor).polygon(points,fill=255)
            donor = original.transform(FRAME,Image.Transform.AFFINE,
                (1,-.7*slope,240*slope,0,.3,240),Image.Resampling.BICUBIC)
            body.paste(donor,(0,0),ImageChops.multiply(mask,corridor))
        body,wrist,angle,correction = repair_forearm(original,body,rig,i,wrist,angle,mask,source)
        joints.append({'wrist':wrist,'handAngle':angle,'forearmCorrection':correction})
        root = turn([0,6], [0,0], wrist, angle)
        hand = place(fist, rig['fistPivot'], root, angle)
        palms.append(turn(rig['fistGrip'], rig['fistPivot'], root, angle))
        pictures.append(body)
        hand_layers.append(hand)

    # Tightly trimmed native-resolution atlas, with 1px spacing; no giant empty hand sheets.
    entries = [(f'body-{i}', im) for i, im in enumerate(pictures)]
    entries += [(f'hand-{i}', im) for i, im in enumerate(hand_layers)]
    idle = rig['idle']
    idle_body = Image.open(ROOT/idle['source']).convert('RGBA')
    mask = Image.new('L',idle_body.size)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in idle['handMask']],fill=255)
    idle_body.putalpha(ImageChops.multiply(idle_body.getchannel('A'),ImageChops.invert(mask)))
    idle_root = turn([0,6],[0,0],idle['wrist'],idle['handAngle'])
    idle_hand = place(fist,rig['fistPivot'],idle_root,idle['handAngle'],idle_body.size)
    idle_palm = turn(rig['fistGrip'],rig['fistPivot'],idle_root,idle['handAngle'])
    idle_guard_body = idle_body.copy()
    mask = Image.new('L',idle_body.size)
    for polygon in idle['shieldArmMasks']:
        ImageDraw.Draw(mask).polygon([tuple(p) for p in polygon],fill=255)
    idle_guard_body.putalpha(ImageChops.multiply(idle_body.getchannel('A'),ImageChops.invert(mask)))
    entries += [('idle-body',idle_body),('idle-guard-body',idle_guard_body),('idle-hand',idle_hand)]
    rects, x, y, row_h = [], 1, 1, 0
    for name, im in entries:
        box = im.getbbox()
        w, h = box[2]-box[0], box[3]-box[1]
        if x+w+1 > 2048:
            x, y, row_h = 1, y+row_h+2, 0
        rects.append((name, im, box, x, y))
        x += w+2
        row_h = max(row_h, h)
    atlas = Image.new('RGBA', (max(px+box[2]-box[0]+1 for _,_,box,px,_ in rects), y+row_h+1))
    frames = {}
    for name, im, box, px, py in rects:
        w, h = box[2]-box[0], box[3]-box[1]
        atlas.paste(im.crop(box), (px,py))
        frames[name] = {'frame': {'x':px,'y':py,'w':w,'h':h}, 'rotated':False, 'trimmed':True,
            'spriteSourceSize': {'x':box[0],'y':box[1],'w':w,'h':h}, 'sourceSize': {'w':im.width,'h':im.height}}
    out = ROOT/'assets/player/sword-walk-grip'
    out.mkdir(parents=True, exist_ok=True)
    atlas.save(out/'walk.png')
    (out/'walk.json').write_text(json.dumps({'frames':frames,'meta':{'image':'walk.png',
        'size':{'w':atlas.width,'h':atlas.height},'scale':'1'}}, separators=(',',':'))+'\n', encoding='utf-8')
    metadata = {'sourceSize':512,'sourceHeight':516,'fps':rig['frameRate'],
        'pages':[{'key':'player_sword_walk_grip','image':'assets/player/sword-walk-grip/walk.png',
                  'atlas':'assets/player/sword-walk-grip/walk.json','width':atlas.width,'height':atlas.height}],
        'poses':[{'body':[0,f'body-{i}'],'hand':[0,f'hand-{i}'],'frameIndex':i,
                  'main':point} for i,point in enumerate(palms)],
        'joints':joints,
        'idle':{'sourceSize':idle['sourceSize'],'body':'idle-body','guardBody':'idle-guard-body',
                'hand':'idle-hand','main':idle_palm,'referenceHoldOffset':idle['referenceHoldOffset']},
        'rigSource':'tools/animation/player-sword-walk-grip-20260831/rig.json',
        'rgbaBytes':atlas.width*atlas.height*4}
    (ROOT/'data/player-sword-walk-grip.json').write_text(json.dumps(metadata,separators=(',',':'))+'\n',encoding='utf-8')
    walk_frames = [{'offsetX':round((p[0]/512-.5)*144,4),'offsetY':round((p[1]/516-.5)*144,4),
                   'rotation':rig['swordAngle'],'scale':rig['swordScale']} for p in palms]
    (HERE/'walk-frames.json').write_text(json.dumps(walk_frames,indent=2)+'\n',encoding='utf-8')
    if args.publish_config:
        block = '"walkFrames": '+json.dumps({'type':'perFrame','anchor':'grip','frames':walk_frames},indent=2)
        block = block.replace('\n','\n    ')
        for name in ('data/weapon-anim-config.json','public/data/weapon-anim-config.json'):
            path = ROOT/name
            text,count = re.subn(r'"walkFrames":\s*\{\s*"type":\s*"perFrame",\s*"anchor":\s*"grip",\s*"frames":\s*\[.*?\]\s*\}',
                lambda _:block,path.read_text(encoding='utf-8'),count=1,flags=re.S)
            if count != 1:
                raise RuntimeError('Walking grip block not found: '+name)
            path.write_text(text,encoding='utf-8')

    contact = Image.new('RGB',(7*224,3*280),'#30343b')
    detail = Image.new('RGB',(7*224,3*236),'#e9e4d9')
    for i,(body,hand,palm) in enumerate(zip(pictures,hand_layers,palms)):
        complete = Image.alpha_composite(body,hand)
        thumb = complete.resize((224,226),Image.Resampling.LANCZOS)
        contact.paste(thumb,(i%7*224,i//7*280+25),thumb)
        ImageDraw.Draw(contact).text((i%7*224+8,i//7*280+6),f'FRAME {i}',fill='white')
        region = (round(palm[0])-28,round(palm[1])-35,round(palm[0])+28,round(palm[1])+20)
        crop = complete.crop(region).resize((224,220),Image.Resampling.NEAREST)
        detail.paste(crop,(i%7*224,i//7*236+16),crop)
        ImageDraw.Draw(detail).text((i%7*224+5,i//7*236),f'{i}',fill='black')
    contact.save(HERE/'grip-contact.png')
    detail.save(HERE/'grip-detail.png')

    swords = [('Rusty','weapon_rusty_sword','assets/weapons/1-rusty_sword_euip.png'),
              ('Knight','weapon_knights_sword','assets/weapons/knights_sword_ingame_v2.png'),
              ('Rune','weapon_rune_sword','assets/weapons/rune_sword_ingame_v2.png'),
              ('Night flame','weapon_night_flame','assets/weapons/night_flame_sword_ingame_v2.png')]
    sword_cfg = json.loads((ROOT/'data/weapon-anim-config.json').read_text(encoding='utf-8'))['sword']
    grips = sword_cfg['textureGrips']
    rendered = []
    # Match 144x144 player display (512x516 source) and 126*.75 sword size.
    for name,key,path in swords:
        sword = Image.open(ROOT/path).convert('RGBA')
        sword = sword.resize((round(126*.75*.63*rig['swordScale']/144*512),
                              round(126*.75*rig['swordScale']/144*512)),Image.Resampling.LANCZOS)
        origin = grips[key]
        cycle = []
        for body,hand,palm in zip(pictures,hand_layers,palms):
            canvas = Image.new('RGBA',CANVAS)
            canvas.alpha_composite(body.resize((512,512),Image.Resampling.LANCZOS),OFFSET)
            canvas.alpha_composite(place(sword,[sword.width*origin['x'],sword.height*origin['y']],
                [palm[0]+OFFSET[0],palm[1]/516*512+OFFSET[1]],rig['swordAngle'],CANVAS))
            canvas.alpha_composite(hand.resize((512,512),Image.Resampling.LANCZOS),OFFSET)
            cycle.append(canvas)
        rendered.append(cycle)
    boards = []
    for i in range(21):
        board = Image.new('RGB',(1536,612),'#30343b')
        draw = ImageDraw.Draw(board)
        for col, (name,_,_) in enumerate(swords):
            for row in range(2):
                im = rendered[col][i]
                if row: im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                im = im.resize((384,280),Image.Resampling.LANCZOS)
                board.paste(im,(col*384,row*306+26),im)
                draw.text((col*384+8,row*306+6),f'{name} / {"LEFT" if row else "RIGHT"} / {i}',fill='white')
        boards.append(board)
    # GIF resolution is 10ms; carry rounding across the cycle rather than speeding it to 40ms/frame.
    durations = [round((i+1)*100/24)*10-round(i*100/24)*10 for i in range(21)]
    boards[0].save(HERE/'four-swords-both-directions.gif',save_all=True,append_images=boards[1:],
                   duration=durations,loop=0,disposal=2)
    boards[0].save(HERE/'four-swords-frame-0.png')
    idle_board = Image.new('RGB',(1536,612),'#30343b')
    idle_cfg = sword_cfg.get('idle',sword_cfg)
    idle_scale = idle_cfg['idleScale']
    idle_rotation = 90+idle_cfg['idleRotation']
    for column,(name,key,path) in enumerate(swords):
        sword = Image.open(ROOT/path).convert('RGBA').resize(
            (round(126*.75*.63*idle_scale/144*512),round(126*.75*idle_scale/144*512)),Image.Resampling.LANCZOS)
        origin = grips[key]
        canvas = Image.new('RGBA',CANVAS)
        canvas.alpha_composite(idle_body.resize((512,512),Image.Resampling.LANCZOS),OFFSET)
        canvas.alpha_composite(place(sword,[sword.width*origin['x'],sword.height*origin['y']],
            [idle_palm[0]/516*512+OFFSET[0],idle_palm[1]/516*512+OFFSET[1]],idle_rotation,CANVAS))
        canvas.alpha_composite(idle_hand.resize((512,512),Image.Resampling.LANCZOS),OFFSET)
        for row in (0,1):
            picture = canvas if row==0 else canvas.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            picture = picture.resize((384,280),Image.Resampling.LANCZOS)
            idle_board.paste(picture,(column*384,row*306+26),picture)
            ImageDraw.Draw(idle_board).text((column*384+8,row*306+6),f'{name} / IDLE / {"LEFT" if row else "RIGHT"}',fill='white')
    idle_board.save(HERE/'idle-four-swords.png')
    print(f'Authored 21 walk grips, atlas {atlas.width}x{atlas.height}, {metadata["rgbaBytes"]/1048576:.2f} MiB RGBA.')


if __name__ == '__main__':
    main()
