"""Body-only calibration and previews for all six existing gaoler sheets."""
from pathlib import Path
import json
import math
import sys
import importlib.util
import runpy
import shutil
import numpy as np
import cv2
from PIL import Image, ImageDraw
from author import cells, CONFIG, ROOT, REPO, SOURCE, INDEX, support_foot

STATES = ('idle','walking','chainSweep','hookWinch','cageSlam','dying')


def display_cell(frame, layout, index, size=(500,380), root=(250,330), scale=None):
    scale = scale or CONFIG['render']['bodyDisplayHeight']/layout['authoredBodyHeight']
    ax = layout.get('anchorXByFrame',[layout['frameWidth']/2]*layout['frameCount'])[index]
    fy = layout.get('footYByFrame',[layout['footY']]*layout['frameCount'])[index]
    sprite = frame.resize((round(frame.width*scale),round(frame.height*scale)),Image.Resampling.LANCZOS)
    canvas = Image.new('RGB',size,'#697781')
    canvas.paste(sprite,(round(root[0]-ax*scale),round(root[1]-fy*scale)),sprite)
    return canvas


def references():
    if not (ROOT/'before-body-config.json').exists():
        (ROOT/'before-body-config.json').write_text(json.dumps(CONFIG,ensure_ascii=False,indent=2),encoding='utf-8')
        (ROOT/'before-body-code.js').write_bytes((REPO/'src/entities/enemy-types/broken-cable-gaoler.js').read_bytes())
    neutral = Image.new('RGB',(1500,800),'#697781')
    for n,state in enumerate(STATES):
        frames,layout = cells(state)
        cell = display_cell(frames[0],layout,0,size=(500,400))
        d = ImageDraw.Draw(cell)
        for x in range(100,451,25):
            d.line((x,0,x,350),fill='#85939b')
            d.text((x+2,350),str(x),fill='white')
        for y in range(30,331,25):
            d.line((90,y,450,y),fill='#85939b')
            d.text((90,y+2),str(y),fill='white')
        d.text((15,382),state+' f0 / existing display scale',fill='white')
        neutral.paste(cell,(n%3*500,n//3*400))
        contact = Image.new('RGB',(8*240,280*math.ceil(len(frames)/8)),'#697781')
        for i,frame in enumerate(frames):
            body = display_cell(frame,layout,i).crop((100,0,420,355)).resize((240,266),Image.Resampling.LANCZOS)
            contact.paste(body,(i%8*240,i//8*280))
            ImageDraw.Draw(contact).text((i%8*240+5,i//8*280+266),str(i),fill='white')
        contact.save(ROOT/f'{state}-all-body-before.png')
    neutral.save(ROOT/'body-neutral-before.png')


def landmark_references():
    frames, layout = cells('walking')
    template = cv2.cvtColor(np.asarray(frames[0])[178:212,322:352,:3], cv2.COLOR_RGB2GRAY)
    points = []
    contact = Image.new('RGB',(8*240,5*240),'#697781')
    for i,frame in enumerate(frames):
        gray = cv2.cvtColor(np.asarray(frame)[:,:,:3],cv2.COLOR_RGB2GRAY)
        score = cv2.matchTemplate(gray[155:240,240:425],template,cv2.TM_CCOEFF_NORMED)
        _, confidence, _, (x,y) = cv2.minMaxLoc(score)
        point = (x+240+15,y+155+17)
        points.append({'x':point[0],'y':point[1],'confidence':round(confidence,3)})
        tile = Image.new('RGB',(240,240),'#697781')
        cut = frame.crop((225,140,445,360))
        tile.paste(cut,(0,0),cut)
        d = ImageDraw.Draw(tile)
        px,py = point[0]-225,point[1]-140
        d.line((px-7,py,px+7,py),fill='#00ffff')
        d.line((px,py-7,px,py+7),fill='#00ffff')
        d.text((5,223),f'f{i} {point} {confidence:.2f}',fill='white')
        contact.paste(tile,(i%8*240,i//8*240))
    contact.save(ROOT/'walking-waist-reference.png')
    (ROOT/'walking-waist-points.json').write_text(json.dumps(points,indent=2),encoding='utf-8')
    pairs = [('chainSweep',17),('chainSweep',19),('hookWinch',5),('hookWinch',7),('hookWinch',15),('dying',21),('dying',23)]
    grid = Image.new('RGB',(3*420,len(pairs)*360),'#697781')
    for row,(state,index) in enumerate(pairs):
        frames,layout = cells(state)
        for col,i in enumerate((index-1,index,index+1)):
            tile=display_cell(frames[i],layout,i,size=(420,360),root=(170,320))
            ImageDraw.Draw(tile).text((10,340),f'{state} f{i}',fill='white')
            grid.paste(tile,(col*420,row*360))
    grid.save(ROOT/'body-interpolation-reference.png')


def walking_root():
    frames,layout=cells('walking')
    gray=[cv2.cvtColor(np.asarray(f)[:,:,:3],cv2.COLOR_RGB2GRAY) for f in frames]
    centers=[np.array([337.0,195.0])]
    for previous,current in zip(gray,gray[1:]):
        cx,cy=centers[-1]
        mask=np.zeros_like(previous)
        mask[round(cy-25):round(cy+18),round(cx-27):round(cx+28)]=255
        points=cv2.goodFeaturesToTrack(previous,60,.02,3,mask=mask)
        next_points,status,_=cv2.calcOpticalFlowPyrLK(previous,current,points,None,winSize=(25,25),maxLevel=3)
        reverse,back_status,_=cv2.calcOpticalFlowPyrLK(current,previous,next_points,None,winSize=(25,25),maxLevel=3)
        good=(status[:,0]>0)&(back_status[:,0]>0)&(np.linalg.norm(reverse-points,axis=2)[:,0]<1.2)
        delta=(next_points-points)[good,0]
        if len(delta)<3: raise ValueError('Waist landmark needs manual authoring')
        centers.append(centers[-1]+np.median(delta,axis=0))
    # The final half-step returns to f0. Remove only accumulated tracking drift.
    drift=centers[-1]-centers[0]
    centers=[point-drift*i/(len(centers)-1) for i,point in enumerate(centers)]
    contact=Image.new('RGB',(8*240,5*240),'#697781')
    for i,(frame,point) in enumerate(zip(frames,centers)):
        tile=Image.new('RGB',(240,240),'#697781'); cut=frame.crop((225,140,445,360));tile.paste(cut,(0,0),cut)
        d=ImageDraw.Draw(tile);px,py=point[0]-225,point[1]-140
        d.line((px-7,py,px+7,py),fill='#00ffff');d.line((px,py-7,px,py+7),fill='#00ffff')
        d.text((5,223),f'f{i} waist x={point[0]:.2f}',fill='white')
        contact.paste(tile,(i%8*240,i//8*240))
    contact.save(ROOT/'walking-waist-flow-reference.png')
    (ROOT/'walking-root.json').write_text(json.dumps({'landmarks':[[round(float(v),3) for v in p] for p in centers], 'trackingLoopDrift':[float(v) for v in drift]},indent=2),encoding='utf-8')


def rebuild_body_midpoints():
    """Repair only broken generated poses, from their untouched authored neighbours."""
    spec=importlib.util.spec_from_file_location('gaoler_rife',REPO/'tools/ai-gen/rife-spritesheet-interpolate.py')
    rife=importlib.util.module_from_spec(spec);spec.loader.exec_module(rife)
    records=[]
    for state,indices in {'chainSweep':[17,19],'hookWinch':[5,7,15]}.items():
        frames,layout=cells(state)
        for index in indices:
            work=ROOT/'body-midpoints'/state/f'f{index:02d}'
            work.mkdir(parents=True,exist_ok=True)
            originals=[]
            for neighbor in (index-1,index+1):
                # Match the support root before optical interpolation. Do not scale or bend a pose.
                dx=round(layout['anchorXByFrame'][index]-layout['anchorXByFrame'][neighbor])
                dy=round(layout['footYByFrame'][index]-layout['footYByFrame'][neighbor])
                aligned=Image.new('RGBA',frames[neighbor].size,(0,0,0,0))
                aligned.paste(frames[neighbor],(dx,dy))
                originals.append(np.asarray(aligned).copy())
            middle,*details=rife.interpolate_pair(originals[0],originals[1],work,rife.DEFAULT_RIFE,True,False,False)
            destination=ROOT/'body-midpoints'/f'{state}-f{index:02d}.png'
            Image.fromarray(middle).save(destination)
            records.append({'state':state,'frame':index,'sourceFrames':[index-1,index+1],
                'path':str(destination.relative_to(REPO)).replace('\\','/'),
                'method':'RIFE v4.6 t=0.5, support-root aligned authored even frames, RGB/alpha split',
                'footShift':details[0],'darkPixelsRepaired':details[1],'redPixelsRepaired':details[2],
                'heldSourceKey':details[3]})
            print(f'{state} f{index}: rebuilt body midpoint',flush=True)
    (ROOT/'body-midpoints.json').write_text(json.dumps(records,indent=2),encoding='utf-8')


def midpoint_preview():
    native='--native' in sys.argv
    records=json.loads((ROOT/('body-native-frames.json' if native else 'body-midpoints.json')).read_text(encoding='utf-8'))
    contact=Image.new('RGB',(2*420,len(records)*360),'#697781')
    for row,record in enumerate(records):
        state,index=record['state'],record['frame']
        frames,layout=cells(state)
        for col,frame in enumerate((frames[index],Image.open(REPO/record['path']).convert('RGBA'))):
            use_layout=json.loads(json.dumps(layout))
            if native and col==1:
                use_layout['anchorXByFrame'][index]=record['anchorX']
                use_layout['footYByFrame'][index]=record['footY']
            tile=display_cell(frame,use_layout,index,size=(420,360),root=(170,320))
            ImageDraw.Draw(tile).text((10,340),f'{state} f{index}: '+('BEFORE' if col==0 else 'REBUILT'),fill='white')
            contact.paste(tile,(col*420,row*360))
    contact.save(ROOT/('body-native-comparison.png' if native else 'body-midpoints-comparison.png'))


def native_body_frames():
    common=runpy.run_path(str(REPO/'tools/ai-gen/character-one-shot-video-rebuild.py'))
    model=common['get_model']()
    manifests=json.loads((SOURCE/'runtime-layouts.json').read_text(encoding='utf-8'))['actions']
    idle,idle_layout=cells('idle');refx,refy=support_foot(idle[0],idle_layout)
    refscale=CONFIG['render']['bodyDisplayHeight']/idle_layout['authoredBodyHeight']
    reference_x=(refx-idle_layout['frameWidth']/2)*refscale
    reference_y=(refy-idle_layout['footY'])*refscale
    records=[]
    for state,indices in {'chainSweep':[17,19],'hookWinch':[5,7,15]}.items():
        action=INDEX['actions'][state]
        report=json.loads((SOURCE/action['baseReport']).read_text(encoding='utf-8'))
        layout=CONFIG['textures']['frameLayouts'][state];crop=manifests[state]
        source_frames,fps=common['decode'](SOURCE/action['sourceVideo'])
        for index in indices:
            source_index=action['window']['sourceStart']+index*action['window']['sampleStep']//2
            rgba=common['cutout'](source_frames[source_index],model)
            placed=common['place_grounded'](rgba,report['fixedScale'],report['frameWidth'],report['frameHeight'],action['layout']['footY'],'lower-body')
            x,y=crop['cropLeft'],crop['cropTop']
            frame=Image.fromarray(placed).crop((x,y,x+layout['frameWidth'],y+layout['frameHeight']))
            bootx,booty=support_foot(frame,layout)
            scale=CONFIG['render']['bodyDisplayHeight']/layout['authoredBodyHeight']
            destination=ROOT/'body-native-frames'/f'{state}-f{index:02d}.png'
            destination.parent.mkdir(parents=True,exist_ok=True);frame.save(destination)
            records.append({'state':state,'frame':index,'sourceFrame':source_index,'sourceFps':fps,
                'sourceVideo':str((SOURCE/action['sourceVideo']).relative_to(REPO)).replace('\\','/'),
                'sourcePixelScale':report['fixedScale'],'path':str(destination.relative_to(REPO)).replace('\\','/'),
                'anchorX':round(bootx-reference_x/scale,3),'footY':round(booty-reference_y/scale,3),
                'method':'native video midpoint + original BiRefNet cutout/fixed scale; no new pose generation'})
            print(f'{state} output f{index} <- native video f{source_index}',flush=True)
    (ROOT/'body-native-frames.json').write_text(json.dumps(records,indent=2),encoding='utf-8')


def install_body():
    baseline=json.loads((ROOT/'before-body-config.json').read_text(encoding='utf-8'))
    native=json.loads((ROOT/'body-native-frames.json').read_text(encoding='utf-8'))
    waist=json.loads((ROOT/'walking-root.json').read_text(encoding='utf-8'))['landmarks']
    calibration={'method':'fixed authored scale; walking waist X; planted attack boot; fixed death root preserves fall',
        'scaleReference':'idle body, excluding cage/cable/hook/shoulder winch; retain existing 260 world-pixel standard',
        'actions':{}}
    for state in STATES:
        layout=baseline['textures']['frameLayouts'][state]
        count=layout['frameCount']
        entry={k:layout[k] for k in ('frameWidth','frameHeight','frameCount')}
        entry['anchorXByFrame']=layout.get('anchorXByFrame',[layout['frameWidth']/2]*count).copy()
        entry['footYByFrame']=layout.get('footYByFrame',[layout['footY']]*count).copy()
        if state=='walking':
            # Preserve f0's existing body location, remove only the recentering of the waist.
            entry['anchorXByFrame']=[round(layout['frameWidth']/2+p[0]-waist[0][0],3) for p in waist]
        elif state=='dying':
            frames,_=cells(state);idle,idle_layout=cells('idle')
            dx,dy=support_foot(frames[0],layout);ix,iy=support_foot(idle[0],idle_layout)
            ratio=layout['authoredBodyHeight']/idle_layout['authoredBodyHeight']
            entry['anchorXByFrame']=[round(dx-(ix-idle_layout['frameWidth']/2)*ratio,3)]*count
            entry['footYByFrame']=[round(dy-(iy-idle_layout['footY'])*ratio,3)]*count
        overrides=[record for record in native if record['state']==state]
        if overrides:
            entry['frameOverrides']=overrides
            sheet_path=REPO/baseline['textures'][state]
            backup=ROOT/'before-body-sheets'/sheet_path.name
            backup.parent.mkdir(exist_ok=True)
            if not backup.exists(): shutil.copyfile(sheet_path,backup)
            sheet=Image.open(backup).convert('RGBA')
            for record in overrides:
                index=record['frame'];frame=Image.open(REPO/record['path']).convert('RGBA')
                sheet.paste(frame,(index%layout['columns']*layout['frameWidth'],index//layout['columns']*layout['frameHeight']))
                entry['anchorXByFrame'][index]=record['anchorX']
                entry['footYByFrame'][index]=record['footY']
            sheet.save(sheet_path)
        calibration['actions'][state]=entry
    for path in (ROOT/'body-calibration.json',SOURCE/'runtime-anchors.json'):
        path.write_text(json.dumps(calibration,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for path in (REPO/'data/enemy-config.json',REPO/'public/data/enemy-config.json'):
        text=path.read_bytes().decode('utf-8');start=text.index('{',text.index('"brokenCableGaoler":'))
        value,length=json.JSONDecoder().raw_decode(text[start:])
        for state,record in calibration['actions'].items():
            for key in ('anchorXByFrame','footYByFrame'):value['textures']['frameLayouts'][state][key]=record[key]
        newline='\r\n' if '\r\n' in text else '\n'
        rendered=json.dumps(value,ensure_ascii=False,indent=2).replace('\n',newline+'  ')
        path.write_bytes((text[:start]+rendered+text[start+length:]).encode('utf-8'))
    for path in (SOURCE/'runtime-layouts.json',REPO/'assets/enemies/broken_cable_gaoler/spritesheet-manifest.json'):
        value=json.loads(path.read_text(encoding='utf-8'))
        value['bodyCalibration']='tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/body-calibration.json'
        for state,record in calibration['actions'].items():value['actions'][state].update(record)
        path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    path=SOURCE/'task-index.json';value=json.loads(path.read_text(encoding='utf-8'))
    value['runtimeBodyCalibration']='../../_broken_cable_gaoler_attack_fix_20260830/body-calibration.json'
    value['runtimeAnimationFixNotes']='../../../../docs/broken-cable-gaoler-attack-fix-2026-08-30.md'
    for state in STATES:
        value['actions'][state]['runtimeBodyPreview']='../../_broken_cable_gaoler_attack_fix_20260830/'+state+'-body-final.gif'
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Installed six body roots and five native-frame repairs; scales, layouts and timing unchanged.')


def final_previews():
    animations={state:cells(state) for state in STATES}
    for state,(frames,layout) in animations.items():
        rendered=[];duration=layout.get('duration',1000*len(frames)/layout.get('frameRate',24))
        delays=[round((i+1)*duration/len(frames)/10)*10-round(i*duration/len(frames)/10)*10 for i in range(len(frames))]
        for i,frame in enumerate(frames):
            canvas=display_cell(frame,layout,i,size=(500,360),root=(250,320))
            d=ImageDraw.Draw(canvas);d.line((0,320,500,320),fill='#ccb674')
            d.text((10,340),f'{state} f{i} / fixed body scale / authored preview',fill='white')
            rendered.append(canvas)
        rendered[0].save(ROOT/f'{state}-body-final.gif',save_all=True,append_images=rendered[1:],duration=delays,loop=0,disposal=2)
    combined=[];delays=[]
    for tick in range(120):
        t=tick/24*1000;canvas=Image.new('RGB',(1500,720),'#697781')
        for n,state in enumerate(STATES):
            frames,layout=animations[state]
            duration=layout.get('duration',1000*len(frames)/layout.get('frameRate',24))
            i=min(len(frames)-1,int(t/duration*len(frames))) if state=='dying' else int(t/duration*len(frames))%len(frames)
            tile=display_cell(frames[i],layout,i,size=(500,360),root=(250,320))
            d=ImageDraw.Draw(tile);d.line((0,320,500,320),fill='#ccb674')
            d.text((10,340),f'{state} f{i} / body preview (not game capture)',fill='white')
            canvas.paste(tile,(n%3*500,n//3*360))
        combined.append(canvas.resize((1200,576),Image.Resampling.LANCZOS))
        delays.append(round((tick+1)*1000/24/10)*10-round(tick*1000/24/10)*10)
    combined[0].save(ROOT/'all-six-body-final.gif',save_all=True,append_images=combined[1:],duration=delays,loop=0,disposal=2)
    # Same stride frames and time on both rows, showing only the anchor change.
    baseline=json.loads((ROOT/'before-body-config.json').read_text(encoding='utf-8'))
    frames,layout=animations['walking'];comparison=[];delays=[]
    for i,frame in enumerate(frames):
        canvas=Image.new('RGB',(500,720),'#697781')
        for row,l in enumerate((baseline['textures']['frameLayouts']['walking'],layout)):
            tile=display_cell(frame,l,i,size=(500,360),root=(250,320))
            d=ImageDraw.Draw(tile);d.line((250,30,250,325),fill='#ccb674');d.line((0,320,500,320),fill='#ccb674')
            d.text((10,340),f'walking f{i}: '+('BEFORE' if row==0 else 'WAIST ROOT'),fill='white')
            canvas.paste(tile,(0,row*360))
        comparison.append(canvas)
        delays.append(round((i+1)*1000/24/10)*10-round(i*1000/24/10)*10)
    comparison[0].save(ROOT/'walking-body-comparison.gif',save_all=True,append_images=comparison[1:],duration=delays,loop=0,disposal=2)
    print('Wrote six full-frame action GIFs, overview and walking comparison.')


if __name__ == '__main__':
    if '--install-body' in sys.argv: install_body()
    elif '--final-previews' in sys.argv: final_previews()
    elif '--native-frames' in sys.argv: native_body_frames()
    elif '--midpoint-preview' in sys.argv: midpoint_preview()
    elif '--rebuild-midpoints' in sys.argv: rebuild_body_midpoints()
    elif '--root' in sys.argv: walking_root()
    elif '--landmarks' in sys.argv: landmark_references()
    else: references()
