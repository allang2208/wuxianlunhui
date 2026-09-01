"""Author the sword combo palm layers, visual tracks and offline previews. No game tests."""
import argparse
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
from prepare import clean, ROOT, HERE

def turn(image,pivot,point,angle,size=(512,512)):
    c,s=math.cos(math.radians(angle)),math.sin(math.radians(angle))
    return image.transform(size,Image.Transform.AFFINE,
        (c,s,pivot[0]-c*point[0]-s*point[1],-s,c,pivot[1]+s*point[0]-c*point[1]),Image.Resampling.BICUBIC)

def replace_visual_frames(path,blocks):
    # Separate display blocks preserve legacy tracks consumed by staff/special attacks.
    raw=path.read_text(encoding='utf-8')
    sword=raw.index('"sword":')
    for key,frames in blocks.items():
        token='"'+key+'Grip":'
        block=json.dumps({'type':'perFrame','anchor':'grip','frames':frames},indent=2).replace('\n','\n    ')
        if token in raw[sword:]:
            start=raw.index(token,sword)+len(token)
            left=start+len(raw[start:])-len(raw[start:].lstrip())
            _,length=json.JSONDecoder().raw_decode(raw[left:])
            raw=raw[:left]+block+raw[left+length:]
        else:
            left=raw.index('{',sword)+1
            raw=raw[:left]+'\n    '+token+' '+block+','+raw[left:]
    path.write_text(raw,encoding='utf-8')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish-config',action='store_true')
    args=parser.parse_args()
    rig=json.loads((HERE/'rig.json').read_text(encoding='utf-8'))
    anims=json.loads((ROOT/'data/player-anim-config.json').read_text(encoding='utf-8'))
    sword=json.loads((ROOT/'data/weapon-anim-config.json').read_text(encoding='utf-8'))['sword']
    combo=json.loads((ROOT/'data/combat-config.json').read_text(encoding='utf-8'))['meleeCombo']
    parts,poses,pictures,blocks=[],{}, {},{}
    # Reuse the exact offhand source-frame tracks, including source-relative shield tilt/depth.
    import re
    shield_text=(ROOT/'src/config/player-shield-poses.js').read_text(encoding='utf-8')
    offhands={}
    for key,name in [('attack_sword','attack1'),('attack_sword_2','attack2'),('attack_sword_3','attack3'),('recover','recover')]:
        block=re.search(r'const '+name+r' = poseTrack\([^\n]+, \[(.*?)\n\]\);',shield_text,re.S).group(1)
        offhands[key]=[json.loads('['+row+']') for row in re.findall(r'\[([^\[\]]+)\]',block)]
    for anim,corrections in rig['offhandCorrections'].items():
        for index,pose in corrections.items(): offhands[anim][int(index)]=pose
    configs={v['anim']:(k,v) for k,v in rig['stages'].items()}
    configs['recover']=(None,rig['recover'])
    for anim,(key,track) in configs.items():
        definition=anims[anim]
        source=clean(Image.open(ROOT/definition['src']))
        poses[anim]=[]
        if key: blocks[key]=[]
        for i,palm in enumerate(track['palms']):
            x,y=i%definition['cols']*512,i//definition['cols']*512
            body=source.crop((x,y,x+512,y+512))
            mask=Image.new('L',(512,512))
            if key:
                # Tight native palm, not the previous broad two-ellipse mask that could lift
                # elbow/torso pixels in front of the blade. Body stays pixel-for-pixel native.
                ImageDraw.Draw(mask).ellipse((palm[0]-15,palm[1]-17,palm[0]+15,palm[1]+17),fill=255)
                hand=body.copy()
                hand.putalpha(ImageChops.multiply(hand.getchannel('A'),mask))
            else:
                # Close only the old recover fingers using the already approved idle/walk fist.
                ImageDraw.Draw(mask).polygon([(palm[0]-18,palm[1]-16),(palm[0]+17,palm[1]-16),
                    (palm[0]+22,palm[1]+28),(palm[0]-20,palm[1]+28)],fill=255)
                body.putalpha(ImageChops.multiply(body.getchannel('A'),ImageChops.invert(mask)))
                fist=Image.open(ROOT/track['fistSource']).convert('RGBA')
                hand=turn(fist,(16,20),palm,track['handAngle'])
                # Keeping the fist beneath the sword too avoids a gap at its alpha edge.
                body.alpha_composite(hand)
            name=f'{anim}-{i}'
            pictures[name]=(body,hand)
            parts.extend([(name+'-body',body),(name+'-hand',hand)])
            poses[anim].append({'body':name+'-body','hand':name+'-hand','main':palm,'shield':offhands[anim][i]})
            if key:
                original=sword[key]['frames'][i]
                blocks[key].append({**original,
                    'offsetX':round((palm[0]/512-.5)*144*rig['displayScale'],4),
                    'offsetY':round((palm[1]/512-.5)*144*rig['displayScale'],4),
                    'rotation':track['angles'][i],'scale':original.get('scale',1.5),
                    'stretchX':1,'stretchY':1,'blurX':track['blur'][i],'blurY':round(track['blur'][i]*.08,3)})
    out=ROOT/'assets/player/sword-combo-grip'
    out.mkdir(parents=True,exist_ok=True)
    # Bounded 2048 pages, tight trimmed source rectangles with native 512 source coordinates.
    pages,locations=[],{}
    atlas=Image.new('RGBA',(2048,2048)); frames={}; x=y=1; row=0
    def save_page():
        page=len(pages); bottom=y+row+1
        width=max(f['frame']['x']+f['frame']['w']+1 for f in frames.values())
        atlas.crop((0,0,width,bottom)).save(out/f'combo-{page}.png')
        (out/f'combo-{page}.json').write_text(json.dumps({'frames':frames,'meta':{
            'image':f'combo-{page}.png','size':{'w':width,'h':bottom},'scale':'1'}},separators=(',',':'))+'\n',encoding='utf-8')
        pages.append({'key':f'player_sword_combo_grip_{page}','image':f'assets/player/sword-combo-grip/combo-{page}.png',
            'atlas':f'assets/player/sword-combo-grip/combo-{page}.json','width':width,'height':bottom})
    for name,picture in parts:
        box=picture.getbbox()
        if box is None: raise ValueError(f'Authoring mask misses the source palm: {name}')
        w,h=box[2]-box[0],box[3]-box[1]
        if x+w+1>2048: x,y,row=1,y+row+2,0
        if y+h+1>2048:
            save_page(); atlas=Image.new('RGBA',(2048,2048)); frames={}; x=y=1; row=0
        atlas.paste(picture.crop(box),(x,y))
        frames[name]={'frame':{'x':x,'y':y,'w':w,'h':h},'rotated':False,'trimmed':True,
            'spriteSourceSize':{'x':box[0],'y':box[1],'w':w,'h':h},'sourceSize':{'w':512,'h':512}}
        locations[name]=[len(pages),name]
        x+=w+2; row=max(row,h)
    save_page()
    for track in poses.values():
        for pose in track:
            for layer in ('body','hand'): pose[layer]=locations[pose[layer]]
    metadata={'sourceSize':512,'displayScale':rig['displayScale'],'pages':pages,'poses':poses,
        'recoverTracks':rig['recoverTracks'],'defaults':blocks,
        'rigSource':'tools/animation/player-sword-combo-grip-20260901/rig.json'}
    (ROOT/'data/player-sword-combo-grip.json').write_text(json.dumps(metadata,separators=(',',':'))+'\n',encoding='utf-8')
    (HERE/'visual-frames.json').write_text(json.dumps(blocks,indent=2)+'\n',encoding='utf-8')
    if args.publish_config:
        for file in ('data/weapon-anim-config.json','public/data/weapon-anim-config.json'):
            replace_visual_frames(ROOT/file,blocks)
    # Offline four actual swords, both facings, using the same discrete frame and per-frame durations.
    swords=[('Rusty','weapon_rusty_sword','1-rusty_sword_euip.png'),('Knight','weapon_knights_sword','knights_sword_ingame_v2.png'),
        ('Rune','weapon_rune_sword','rune_sword_ingame_v2.png'),('Night flame','weapon_night_flame','night_flame_sword_ingame_v2.png')]
    sprites={k:Image.open(ROOT/'assets/weapons'/file).convert('RGBA') for _,k,file in swords}
    disp=144*rig['displayScale']; canvas_size=(1152,1000); offset=(208,400)
    tile_w,tile_h,stride=384,333,353
    def render(anim,index,frame,weapon):
        body,hand=pictures[f'{anim}-{index}']
        picture=Image.new('RGBA',canvas_size); picture.alpha_composite(body,offset)
        size=126*.75*frame['scale']/disp*512
        sword_image=sprites[weapon].resize((round(size*.63),round(size)),Image.Resampling.LANCZOS)
        grip=sword['textureGrips'][weapon]; point=poses[anim][index]['main']
        picture.alpha_composite(turn(sword_image,(grip['x']*sword_image.width,grip['y']*sword_image.height),
            (point[0]+offset[0],point[1]+offset[1]),frame['rotation'],canvas_size))
        picture.alpha_composite(hand,offset)
        return picture
    def board_for(anim,index,frame,label):
        board=Image.new('RGB',(1536,stride*2),'#30343b'); d=ImageDraw.Draw(board)
        for col,(name,key,_) in enumerate(swords):
            im=render(anim,index,frame,key)
            for facing in range(2):
                p=im if facing==0 else im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                p=p.resize((tile_w,tile_h),Image.Resampling.LANCZOS)
                board.paste(p,(col*tile_w,facing*stride+16),p)
                d.text((col*tile_w+6,facing*stride+3),f'{name} / {"R" if facing==0 else "L"} / {label}',fill='white')
        return board
    chain,chain_times=[],[]
    for key,track in rig['stages'].items():
        anim=track['anim']; boards=[board_for(anim,i,f,f'{key}:{i}') for i,f in enumerate(blocks[key])]
        durations=list(anims[anim]['frameDurations'])
        chain.extend(boards); chain_times.extend(durations)
        contact=Image.new('RGB',(1536,((len(boards)+3)//4)*stride),'#30343b')
        for i,frame in enumerate(blocks[key]):
            im=render(anim,i,frame,'weapon_rusty_sword').resize((tile_w,tile_h),Image.Resampling.LANCZOS)
            contact.paste(im,(i%4*tile_w,i//4*stride+16),im)
            ImageDraw.Draw(contact).text((i%4*tile_w+6,i//4*stride+3),f'{key}:{i} / angle {frame["rotation"]}',fill='white')
        contact.save(HERE/f'{key}-contact.png')
        # Include the existing hold, the stage-specific native return and the final idle pose.
        hold=int(combo['stage1HoldMs' if key=='attack' else 'stage2HoldMs' if key=='attack2' else 'stage3HoldMs'])
        sequence=list(boards); times=list(durations)
        if hold: sequence.append(boards[-1]); times.append(hold)
        recover_ms=sum(anims['recover']['frameDurations']) if key=='attack' else combo['stage2RecoverMs' if key=='attack2' else 'stage3RecoverMs']
        for i,(source,index,angle) in enumerate(rig['recoverTracks'][key]):
            frame={'rotation':angle,'scale':1.5}
            sequence.append(board_for(source,index,frame,f'{key} recover:{i}'))
            times.append(round((i+1)*recover_ms/130)*10-round(i*recover_ms/130)*10)
        # Show an actual final idle grip with its smaller native display size, not an invented endpoint.
        walk=json.loads((ROOT/'data/player-sword-walk-grip.json').read_text(encoding='utf-8'))
        walk_atlas=json.loads((ROOT/walk['pages'][0]['atlas']).read_text(encoding='utf-8'))['frames']
        walk_image=Image.open(ROOT/walk['pages'][0]['image']).convert('RGBA')
        def idle_part(name):
            entry=walk_atlas[name]; rect=entry['frame']; trim=entry['spriteSourceSize']
            im=Image.new('RGBA',(516,516)); im.paste(walk_image.crop((rect['x'],rect['y'],rect['x']+rect['w'],rect['y']+rect['h'])),(trim['x'],trim['y']))
            return im
        idle_size=round(512/rig['displayScale']); inset=(512-idle_size)/2
        idle_body=idle_part(walk['idle']['body']).resize((idle_size,idle_size),Image.Resampling.LANCZOS)
        idle_hand=idle_part(walk['idle']['hand']).resize((idle_size,idle_size),Image.Resampling.LANCZOS)
        idle_board=Image.new('RGB',(1536,stride*2),'#30343b')
        for col,(name,weapon,_) in enumerate(swords):
            picture=Image.new('RGBA',canvas_size)
            at=(round(offset[0]+inset),round(offset[1]+inset))
            picture.alpha_composite(idle_body,at)
            size=126*.75*sword['idle']['idleScale']/disp*512
            sword_image=sprites[weapon].resize((round(size*.63),round(size)),Image.Resampling.LANCZOS)
            grip=sword['textureGrips'][weapon]; palm=walk['idle']['main']
            point=(at[0]+palm[0]/516*idle_size,at[1]+palm[1]/516*idle_size)
            picture.alpha_composite(turn(sword_image,(grip['x']*sword_image.width,grip['y']*sword_image.height),point,
                90+sword['idle']['idleRotation'],canvas_size))
            picture.alpha_composite(idle_hand,at)
            for facing in range(2):
                p=picture if facing==0 else picture.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                p=p.resize((tile_w,tile_h),Image.Resampling.LANCZOS)
                idle_board.paste(p,(col*tile_w,facing*stride+16),p)
                ImageDraw.Draw(idle_board).text((col*tile_w+6,facing*stride+3),f'{name} / {"R" if facing==0 else "L"} / IDLE',fill='white')
        sequence.append(idle_board); times.append(500)
        sequence[0].save(HERE/f'{key}-with-recover.gif',save_all=True,append_images=sequence[1:],duration=times,loop=0,disposal=2)
        if key=='attack3':
            chain.extend(sequence[len(boards):]); chain_times.extend(times[len(boards):])
    chain[0].save(HERE/'combo-chain-four-swords.gif',save_all=True,append_images=chain[1:],duration=chain_times,loop=0,disposal=2)
    detail=Image.new('RGB',(1040,4*220),'#ddd8cf')
    for i,palm in enumerate(rig['recover']['palms']):
        body,hand=pictures[f'recover-{i}']; complete=Image.alpha_composite(body,hand)
        box=(palm[0]-35,palm[1]-45,palm[0]+35,palm[1]+25)
        patch=complete.crop(box).resize((200,200),Image.Resampling.NEAREST)
        detail.paste(patch,(i%4*260,i//4*220+20),patch)
        ImageDraw.Draw(detail).text((i%4*260+4,i//4*220+4),f'Recover {i}',fill='black')
    detail.save(HERE/'recover-grip-detail.png')
    print('Authored combo palms and return tracks:',[(p['width'],p['height']) for p in pages])

if __name__=='__main__': main()
