"""Author dash-slash grip layers and offline equipment previews; does not run the game."""
import argparse
import json
import math
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]

def turn(image,pivot,point,angle,size):
    c,s=math.cos(math.radians(angle)),math.sin(math.radians(angle))
    return image.transform(size,Image.Transform.AFFINE,
        (c,s,pivot[0]-c*point[0]-s*point[1],-s,c,pivot[1]+s*point[0]-c*point[1]),Image.Resampling.BICUBIC)

def point_turn(point,pivot,angle):
    c,s=math.cos(math.radians(angle)),math.sin(math.radians(angle))
    return [pivot[0]+point[0]*c-point[1]*s,pivot[1]+point[0]*s+point[1]*c]

def unpack(bank,part):
    page,name=part; meta=bank['pages'][page]
    atlas=json.loads((ROOT/meta['atlas']).read_text(encoding='utf-8'))['frames'][name]
    rect,trim,size=atlas['frame'],atlas['spriteSourceSize'],atlas['sourceSize']
    image=Image.new('RGBA',(size['w'],size['h']))
    source=Image.open(ROOT/meta['image']).convert('RGBA')
    image.paste(source.crop((rect['x'],rect['y'],rect['x']+rect['w'],rect['y']+rect['h'])),(trim['x'],trim['y']))
    return image

def publish(frames):
    for relative in ('data/weapon-anim-config.json','public/data/weapon-anim-config.json'):
        path=ROOT/relative; raw=path.read_text(encoding='utf-8'); sword=raw.index('"sword":')
        token='"dashGrip":'
        block=json.dumps({'type':'perFrame','anchor':'grip','frames':frames},indent=2).replace('\n','\n    ')
        if token in raw[sword:]:
            at=raw.index(token,sword)+len(token); at+=len(raw[at:])-len(raw[at:].lstrip())
            _,length=json.JSONDecoder().raw_decode(raw[at:]); raw=raw[:at]+block+raw[at+length:]
        else:
            at=raw.index('{',sword)+1; raw=raw[:at]+'\n    '+token+' '+block+','+raw[at:]
        path.write_text(raw,encoding='utf-8')

def main():
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--publish-config',action='store_true'); args=parser.parse_args()
    rig=json.loads((HERE/'rig.json').read_text(encoding='utf-8'))
    sword=json.loads((ROOT/'data/weapon-anim-config.json').read_text(encoding='utf-8'))['sword']
    motion=json.loads((ROOT/'data/player-sword-shield-motion.json').read_text(encoding='utf-8'))
    walk=json.loads((ROOT/'data/player-sword-walk-grip.json').read_text(encoding='utf-8'))
    shield_text=(ROOT/'src/config/player-shield-poses.js').read_text(encoding='utf-8')
    def shields(name):
        raw=re.search(r'const '+name+r' = poseTrack\([^\n]+, \[(.*?)\n\]\);',shield_text,re.S).group(1)
        return [json.loads('['+row+']') for row in re.findall(r'\[([^\[\]]+)\]',raw)]
    attack_off,recover_off=shields('dashAttack'),shields('dashRecover')
    sheet=Image.open(ROOT/rig['source']).convert('RGBA'); recover_sheet=Image.open(ROOT/rig['recoverSource']).convert('RGBA')
    fist=Image.open(ROOT/rig['fistSource']).convert('RGBA')
    parts,poses,frames,pictures=[],{'attack':[],'recover':[]},[],{}
    def add(name,body,hand,palm,angle,off):
        parts.extend([(name+'-body',body),(name+'-hand',hand)]); pictures[name]=(body,hand)
        return {'body':name+'-body','hand':name+'-hand','main':palm,'angle':angle,'shield':off,
            'sourceWidth':body.width,'sourceHeight':body.height}
    for i,palm in enumerate(rig['palms']):
        body=sheet.crop((i%8*512,i//8*516,i%8*512+512,i//8*516+516))
        if i in (4,5):
            # Close the two open wind-up hands with the adjacent native closed fist.
            donor=sheet.crop((3*512+112,34,3*512+148,74))
            alpha=body.getchannel('A'); ImageDraw.Draw(alpha).rectangle((palm[0]-19,palm[1]-24,palm[0]+20,palm[1]+17),fill=0)
            body.putalpha(alpha); body.alpha_composite(donor,(palm[0]-18,palm[1]-24))
        if i in (14,15):
            # Detached old baked trail only: source body/hand is wholly outside this region.
            alpha=body.getchannel('A'); d=ImageDraw.Draw(alpha)
            d.polygon([(270,0),(512,0),(512,516),(440,516),(440,200),(270,200)],fill=0); body.putalpha(alpha)
        mask=Image.new('L',body.size); ImageDraw.Draw(mask).ellipse((palm[0]-18,palm[1]-20,palm[0]+18,palm[1]+20),fill=255)
        hand=body.copy(); hand.putalpha(ImageChops.multiply(body.getchannel('A'),mask))
        poses['attack'].append(add(f'attack-{i}',body,hand,palm,rig['angles'][i],attack_off[i]))
        frames.append({'offsetX':round((palm[0]/512-.5)*144,4),'offsetY':round((palm[1]/516-.5)*144,4),
            'rotation':rig['angles'][i],'scale':1.5,'stretchX':1,'stretchY':1,'blurX':rig['blur'][i],'blurY':round(rig['blur'][i]*.08,3)})
    for i,wrist in enumerate(rig['recoverWrists']):
        if i==0:
            poses['recover'].append(dict(poses['attack'][-1])); continue
        if i==13:
            body=unpack(walk,[0,walk['idle']['body']]); hand=unpack(walk,[0,walk['idle']['hand']])
            palm=walk['idle']['main']
            shield_config=(ROOT/'src/config/shield-config.js').read_text(encoding='utf-8')
            arm=shield_config.split('export const PLAYER_SHIELD_ARM =',1)[1]
            grip=re.search(r'grip: \{ x: ([\d.]+), y: ([\d.]+)',arm)
            tilt=float(re.search(r'restTilt: ([-\d.]+)',shield_config).group(1))*180/math.pi
            off=[float(grip.group(1)),float(grip.group(2)),tilt,False]
            poses['recover'].append(add('recover-idle',body,hand,palm,105,off)); continue
        body=recover_sheet.crop((i%8*512,i//8*512,i%8*512+512,i//8*512+512))
        original=body.copy()
        angle=rig['recoverFistAngles'][i]; palm=point_turn((0,16),wrist,angle)
        mask=Image.new('L',body.size)
        polygon=[tuple(p) for p in rig['recoverErase'][i]]
        # Include the faint fingertip fringe; do not let residual fingers trail the closed fist.
        polygon=[(x+(5 if x>wrist[0]+13 else -2 if x<wrist[0]-10 else 0),y+(3 if y>wrist[1]+25 else 0)) for x,y in polygon]
        ImageDraw.Draw(mask).polygon(polygon,fill=255)
        body.putalpha(ImageChops.multiply(body.getchannel('A'),ImageChops.invert(mask)))
        donor=rig['legUnderHandRepairs'].get(str(i))
        if donor:
            # The removed open fingers hid a small leg strip. Reuse the visible continuation
            # of that same source-frame bone only inside the cleared hand footprint.
            if 'restoreLine' in donor:
                corridor=Image.new('L',body.size)
                ImageDraw.Draw(corridor).line([tuple(p) for p in donor['restoreLine']],fill=255,width=donor['width'])
                repair=original.copy(); repair.putalpha(ImageChops.multiply(original.getchannel('A'),corridor))
            else:
                box=donor['crop']; dx,dy=donor['offset']; repair=Image.new('RGBA',body.size)
                repair.paste(original.crop(box),(box[0]+dx,box[1]+dy))
            repair.putalpha(ImageChops.multiply(repair.getchannel('A'),mask)); body.alpha_composite(repair)
        hand=turn(fist,(16,4),wrist,angle,body.size); body.alpha_composite(hand)
        poses['recover'].append(add(f'recover-{i}',body,hand,palm,rig['recoverAngles'][i],recover_off[i]))
    # Pack only the new native grip parts. Approved entry/return-run atlases are reused directly.
    out=ROOT/'assets/player/dash-slash-grip'; out.mkdir(parents=True,exist_ok=True)
    pages,locations=[],{}; atlas=Image.new('RGBA',(2048,2048)); entries={}; x=y=1; row=0
    def save():
        p=len(pages); w=max(f['frame']['x']+f['frame']['w']+1 for f in entries.values()); h=y+row+1
        atlas.crop((0,0,w,h)).save(out/f'slash-{p}.png')
        (out/f'slash-{p}.json').write_text(json.dumps({'frames':entries,'meta':{'image':f'slash-{p}.png','size':{'w':w,'h':h},'scale':'1'}},separators=(',',':'))+'\n',encoding='utf-8')
        pages.append({'key':f'player_dash_slash_grip_{p}','image':f'assets/player/dash-slash-grip/slash-{p}.png','atlas':f'assets/player/dash-slash-grip/slash-{p}.json','width':w,'height':h})
    for name,picture in parts:
        box=picture.getbbox()
        if not box: raise ValueError('Empty authoring layer '+name)
        w,h=box[2]-box[0],box[3]-box[1]
        if x+w+1>2048: x,y,row=1,y+row+2,0
        if y+h+1>2048: save(); atlas=Image.new('RGBA',(2048,2048)); entries={}; x=y=1; row=0
        atlas.paste(picture.crop(box),(x,y)); locations[name]=[len(pages),name]
        entries[name]={'frame':{'x':x,'y':y,'w':w,'h':h},'rotated':False,'trimmed':True,
            'spriteSourceSize':{'x':box[0],'y':box[1],'w':w,'h':h},'sourceSize':{'w':picture.width,'h':picture.height}}
        x+=w+2; row=max(row,h)
    save()
    for track in poses.values():
        for pose in track:
            pose['body']=locations[pose['body']]; pose['hand']=locations[pose['hand']]
    data={'pages':pages,'poses':poses,'defaults':frames,'entryReferenceMs':120,'attackReferenceMs':800,
        'returnRunFrame':motion['returnRunFrame'],'returnRunTimes':[400,433.33333,466.66667,500],
        'rigSource':'tools/animation/player-dash-slash-grip-20260901/rig.json'}
    (ROOT/'data/player-dash-slash-grip.json').write_text(json.dumps(data,separators=(',',':'))+'\n',encoding='utf-8')
    (HERE/'visual-frames.json').write_text(json.dumps(frames,indent=2)+'\n',encoding='utf-8')
    if args.publish_config: publish(frames)
    preview(rig,sword,data,motion,pictures)
    print('Authored dash slash:',[(p['width'],p['height']) for p in pages])

def preview(rig,sword,data,motion,pictures):
    weapons=[('Rusty','weapon_rusty_sword','1-rusty_sword_euip.png'),('Knight*','weapon_knights_sword','knights_sword_ingame_v2.png'),
        ('Rune','weapon_rune_sword','rune_sword_ingame_v2.png'),('Night flame','weapon_night_flame','night_flame_sword_ingame_v2.png')]
    sprites={key:Image.open(ROOT/'assets/weapons'/file).convert('RGBA') for _,key,file in weapons}
    run_rig=json.loads((ROOT/'tools/animation/player-sword-shield-run-20260831/rig-export.json').read_text(encoding='utf-8'))
    shield_image=Image.open(ROOT/run_rig['sources']['shield']).convert('RGBA').resize(tuple(run_rig['resolvedShield']['sourceSizeRounded']),Image.Resampling.LANCZOS)
    shield_origin=run_rig['resolvedShield']['grip']
    def body_parts(pose):
        return unpack(data,pose['body']),unpack(data,pose['hand'])
    native=[(*body_parts(p),p['main'],p['angle']) for p in data['poses']['attack']]
    recover=[(*body_parts(p),p['main'],p['angle']) for p in data['poses']['recover']]
    canvas=(1200,1080); offset=(330,410); tw,th=400,360; stride=382
    def render(parts,key,shield=None):
        body,hand,palm,angle=parts
        # Preserve 144px nominal square display, including 512x516 source frame geometry.
        yscale=512/body.height; palm=[palm[0]*512/body.width,palm[1]*yscale]
        body=body.resize((512,512),Image.Resampling.BICUBIC); hand=hand.resize((512,512),Image.Resampling.BICUBIC)
        pic=Image.new('RGBA',canvas)
        shield_layer=None
        if shield:
            x,y,angle_shield,behind=shield
            shield_layer=turn(shield_image,(shield_origin[0]*shield_image.width,shield_origin[1]*shield_image.height),
                (x+offset[0],y+offset[1]),angle_shield,canvas)
            if behind: pic.alpha_composite(shield_layer)
        pic.alpha_composite(body,offset)
        if shield_layer is not None and not shield[3]: pic.alpha_composite(shield_layer)
        height=126*.75*1.5/144*512; blade=sprites[key].resize((round(height*.63),round(height)),Image.Resampling.LANCZOS)
        grip=sword['textureGrips'][key]
        pic.alpha_composite(turn(blade,(grip['x']*blade.width,grip['y']*blade.height),[palm[0]+offset[0],palm[1]+offset[1]],angle,canvas))
        pic.alpha_composite(hand,offset); return pic
    def board(parts,label):
        result=Image.new('RGB',(tw*4,stride*2),'#343940'); d=ImageDraw.Draw(result)
        for col,(name,key,_) in enumerate(weapons):
            pic=render(parts,key)
            for row in range(2):
                tile=(pic if row==0 else pic.transpose(Image.Transpose.FLIP_LEFT_RIGHT)).resize((tw,th),Image.Resampling.LANCZOS)
                result.paste(tile,(col*tw,row*stride+20),tile)
                d.text((col*tw+5,row*stride+3),f'{name} / {"R" if row==0 else "L"} / {label}',fill='white')
        return result
    contact=Image.new('RGB',(tw*4,5*stride),'#343940')
    for i,parts in enumerate(native):
        pic=render(parts,'weapon_rusty_sword').resize((tw,th),Image.Resampling.LANCZOS)
        x,y=i%4*tw,i//4*stride+20; contact.paste(pic,(x,y),pic)
        ImageDraw.Draw(contact).text((x+5,y-17),f'Dash {i} / angle {parts[3]}',fill='white')
    contact.save(HERE/'dash-grip-contact.png')
    boards=[board(p,f'attack {i}') for i,p in enumerate(native)]
    times=[round((i+1)*rig['attackReferenceMs']/170)*10-round(i*rig['attackReferenceMs']/170)*10 for i in range(17)]
    sequence=boards+[boards[-1]]+[board(p,f'recover {i}') for i,p in enumerate(recover)]
    recover_times=[round((i+1)*rig['recoverMs']/140)*10-round(i*rig['recoverMs']/140)*10 for i in range(14)]
    sequence.append(sequence[-1]); times+= [rig['holdMs']]+recover_times+[500]
    sequence[0].save(HERE/'dash-four-swords-with-recover.gif',save_all=True,append_images=sequence[1:],duration=times,loop=0,disposal=2)
    detail=Image.new('RGB',(1040,4*220),'#cbc9c2')
    for i,(body,hand,palm,angle) in enumerate(recover):
        patch=Image.alpha_composite(body,hand).crop((round(palm[0])-35,round(palm[1])-45,round(palm[0])+35,round(palm[1])+25)).resize((200,200),Image.Resampling.NEAREST)
        detail.paste(patch,(i%4*260,i//4*220+20),patch); ImageDraw.Draw(detail).text((i%4*260+4,i//4*220+4),f'Recover {i}',fill='black')
    detail.save(HERE/'recover-grip-detail.png')
    # Complete approved shield-run entry, native down-cut, freeze, and both exits.
    cache={}
    def motion_frame(pose):
        ident=tuple(pose['body'])
        if ident not in cache: cache[ident]=(unpack(motion,pose['body']),unpack(motion,pose['hand']))
        return (*cache[ident],pose['sword']['point'],pose['sword']['angle'])
    def off(pose,native_pose=False):
        if native_pose:
            x,y,a,*behind=pose['shield']
            return [x/pose['sourceWidth']*512,y/pose['sourceHeight']*512,a,bool(behind and behind[0])]
        return [*pose['shield']['point'],pose['shield']['angle'],pose['shield']['behind']]
    def sample(track,time): return next((motion['poses'][ident] for at,ident in reversed(track) if at<=time),motion['poses'][track[0][1]])
    def select(time,exit):
        if time<300:
            p=motion['poses'][motion['run'][(6+int(time/100))%8]]
            return motion_frame(p),off(p),'RUN'
        time-=300
        if time<800:
            k=min(16,int(time/800*17+1e-6))
            if time<120:
                at,ident=next(((at,ident) for at,ident in reversed(motion['entries'][0]) if at<=time),motion['entries'][0][0])
                p=motion['poses'][ident]; frame=motion_frame(p)
                source=min(16,int(at/800*17+1e-6))
                angle=frame[3]+(rig['angles'][source]-(-90+180*at/800))*p['entryMix']
                return (*frame[:3],angle),off(p),'ENTRY'
            return native[k],off(data['poses']['attack'][k],True),f'DASH {k}'
        if time<1300: return native[-1],off(data['poses']['attack'][-1],True),'HOLD'
        if time<1800:
            k=min(13,int((time-1300)/500*14+1e-6))
            if exit=='run' and k>=10:
                p=sample(motion['recovery'],data['returnRunTimes'][k-10]); return motion_frame(p),off(p),'RETURN RUN'
            return recover[k],off(data['poses']['recover'][k],True),f'RECOVER {k}'
        if exit=='idle': return recover[-1],off(data['poses']['recover'][-1],True),'IDLE'
        p=motion['poses'][motion['run'][(data['returnRunFrame']+int((time-1800)/100))%8]]
        return motion_frame(p),off(p),'RUN'
    stamps={0,100,200,1100,1600,2100,2900}
    stamps.update(300+at for at,_ in motion['entries'][0]); stamps.add(420)
    stamps.update(300+i*800/17 for i in range(17))
    stamps.update(1600+i*500/14 for i in range(14))
    stamps.update(range(2100,2900,100)); stamps=sorted(stamps)
    transition=[]
    for time in stamps[:-1]:
        board_image=Image.new('RGB',(tw*2,stride*2),'#343940'); d=ImageDraw.Draw(board_image)
        for row,exit in enumerate(('idle','run')):
            parts,shield,label=select(time,exit); pic=render(parts,'weapon_rusty_sword',shield)
            for col in range(2):
                tile=(pic if col==0 else pic.transpose(Image.Transpose.FLIP_LEFT_RIGHT)).resize((tw,th),Image.Resampling.LANCZOS)
                board_image.paste(tile,(col*tw,row*stride+20),tile)
                d.text((col*tw+5,row*stride+3),f'To {exit} / {label} / {round(time)}ms',fill='white')
        transition.append(board_image)
    durations=[round(b/10)*10-round(a/10)*10 for a,b in zip(stamps,stamps[1:])]
    # Quantization can collapse two neighboring author timestamps; keep the later pose at that boundary.
    visible=[(im,dt) for im,dt in zip(transition,durations) if dt>0]
    visible[0][0].save(HERE/'dash-shield-entry-and-exits.gif',save_all=True,append_images=[im for im,_ in visible[1:]],
        duration=[dt for _,dt in visible],loop=0,disposal=2)
    key_times=[300,347.05882,400,420,770.58824,817.64706,864.70588,911.76471,1100,1635.71429,1957.14286,2100]
    review=Image.new('RGB',(tw*4,stride*3),'#343940')
    for i,time in enumerate(key_times):
        parts,shield,label=select(time,'idle'); im=render(parts,'weapon_rusty_sword',shield).resize((tw,th),Image.Resampling.LANCZOS)
        x,y=i%4*tw,i//4*stride+20; review.paste(im,(x,y),im); ImageDraw.Draw(review).text((x+4,y-17),f'{round(time)}ms / {label}',fill='white')
    review.save(HERE/'dash-transition-contact.png')

if __name__=='__main__': main()
