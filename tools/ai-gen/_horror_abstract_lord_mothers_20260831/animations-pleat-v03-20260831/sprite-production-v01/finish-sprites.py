"""Package the produced sheets and exact-clock previews without runtime writes."""
from pathlib import Path
import json
import math
import numpy as np
from PIL import Image, ImageDraw
from runtime_publication import annotate_publication

ROOT = Path(__file__).resolve().parent
ROOT_POINT = (256, 210)
PREVIEW_SIZE = (512, 240)


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def cells(path, layout, count=None, columns=None):
    sheet = Image.open(path).convert('RGBA')
    w, h = layout['frameWidth'], layout['frameHeight']
    cols = columns or layout['columns']
    return [sheet.crop((i%cols*w, i//cols*h, (i%cols+1)*w, (i//cols+1)*h))
            for i in range(count or layout['frameCount'])]


def checker():
    yy, xx = np.indices((PREVIEW_SIZE[1], PREVIEW_SIZE[0]))
    rgb = np.where((((xx//16+yy//16)%2)==0)[...,None], np.array([40,45,52]), np.array([54,59,66]))
    return Image.fromarray(rgb.astype(np.uint8)).convert('RGBA')


def view(frame, layout):
    out = checker()
    left = round(ROOT_POINT[0]-layout['footX'])
    top = round(ROOT_POINT[1]-layout['footY'])
    out.alpha_composite(frame, (left,top))
    draw = ImageDraw.Draw(out)
    draw.line((ROOT_POINT[0]-5, ROOT_POINT[1]+3, ROOT_POINT[0]+5, ROOT_POINT[1]+3), fill=(180,170,95))
    return out.convert('RGB')


def exact_gif(frames, durations, path, loop):
    boundaries = [0]
    elapsed = 0.0
    for duration in durations:
        elapsed += duration
        boundaries.append(round(elapsed/10)*10)
    clock = [boundaries[i+1]-boundaries[i] for i in range(len(durations))]
    if min(clock)<=0:
        raise ValueError('GIF clock needs sub-10ms intervals')
    options = dict(save_all=True, append_images=frames[1:], duration=clock, disposal=2, optimize=False)
    if loop:
        options['loop']=0
    frames[0].save(path, **options)
    with Image.open(path) as im:
        duration = 0
        for n in range(im.n_frames):
            im.seek(n)
            duration += im.info.get('duration',0)
        return dict(frameCount=im.n_frames, durationMs=duration, intendedDurationMs=sum(durations),
                    quantization='cumulative timestamps rounded to 10ms', looping=loop)


def contact(previews, durations, action):
    indices = np.linspace(0,len(previews)-1,min(24,len(previews)),dtype=int)
    out=Image.new('RGB',(6*384,math.ceil(len(indices)/6)*202),(27,31,37))
    draw=ImageDraw.Draw(out)
    starts=np.cumsum([0]+durations[:-1])
    for slot,i in enumerate(indices):
        x,y=slot%6*384,slot//6*202
        out.paste(previews[i].resize((384,180),Image.Resampling.LANCZOS),(x,y))
        draw.text((x+6,y+184),f'{action} f{i:03d} / {starts[i]/1000:.3f}s',fill=(225,225,225))
    path=ROOT/'previews'/f'{action}-contact.png'
    out.save(path)
    return path


def main():
    composition=read(ROOT/'composition.json')
    records=[]
    overview=Image.new('RGB',(512*4,270*2),(27,31,37))
    draw=ImageDraw.Draw(overview)
    for column,job in enumerate(composition['jobs']):
        action,layout=job['action'],job['layout']
        frames=cells(ROOT/'final'/f'{action}.png',layout)
        originals=cells(ROOT/'keys'/f'{action}.png',layout,len(job['sourceFrameIndices']),job['keyColumns'])
        views=[view(frame,layout) for frame in frames]
        gif=ROOT/'previews'/f'{action}.gif'
        gif_info=exact_gif(views,layout['frameDurationsMs'],gif,job['mode']=='loop')
        contact_path=contact(views,layout['frameDurationsMs'],action)
        representative=(len(frames)//2 if action!='dying' else len(frames)-1)
        for row,index in enumerate((0,representative)):
            x,y=column*512,row*270
            overview.paste(views[index],(x,y))
            draw.text((x+10,y+245),f'{action} frame {index}/{len(frames)-1}',fill=(230,230,230))
        alpha_boxes=[frame.getchannel('A').getbbox() for frame in frames]
        margins=[]
        for box in alpha_boxes:
            if box:
                margins.append(min(box[0],box[1],layout['frameWidth']-box[2],layout['frameHeight']-box[3]))
        key_preserved=all(np.array_equal(np.asarray(key),np.asarray(frames[i*2])) for i,key in enumerate(originals))
        transparent_rgb=sum(int(np.any(np.asarray(frame)[...,:3][np.asarray(frame)[...,3]==0],axis=1).sum()) for frame in frames)
        rife=read(ROOT/'reports'/f'{action}-rife.json')
        loop_delta=None
        if job['mode']=='loop':
            rgb=[np.asarray(frame).astype(np.float32) for frame in views]
            differences=[float(np.abs(rgb[i]-rgb[i-1]).mean()) for i in range(1,len(rgb))]
            seam=float(np.abs(rgb[-1]-rgb[0]).mean())
            loop_delta=dict(lastToFirst=seam,meanAdjacent=float(np.mean(differences)),
                            note='Pixel difference diagnostic only; not a visual seamlessness guarantee.')
        record=dict(action=action, sheet=f'final/{action}.png', sourceSheet=f'keys/{action}.png',
                    sourceVideo=job['video'], sourceFrameIndices=job['sourceFrameIndices'],
                    sourceRange=[job['sourceStart'],job['sourceEndExclusive']], mode=job['mode'],
                    sourceScale=composition['sourceScale'], layout=layout,
                    decodedBytes=job['gpuBytes'], decodedMiB=job['gpuBytes']/1024**2,
                    textureKeyProposal=f'enemy_pleat_devourer_{action}', registered=False,
                    gif=f'previews/{action}.gif', contact=contact_path.relative_to(ROOT).as_posix(),
                    gifClock=gif_info, sourceKeysPreservedAtEvenFrames=key_preserved,
                    emptyFrames=sum(box is None for box in alpha_boxes), minAlphaMargin=min(margins),
                    transparentPixelsWithNonzeroRGB=transparent_rgb,
                    interpolationReport=f'reports/{action}-rife.json',
                    interpolationStatistics=rife['validation'], loopDifference=loop_delta)
        if action=='attack':
            source_key=51
            output_key=job['sourceFrameIndices'].index(source_key)*2
            record['visualPressPoseCandidate']=dict(sourceFrame=source_key,outputFrame=output_key,
                timeMs=sum(layout['frameDurationsMs'][:output_key]),
                status='visual pose only; contact/reach requires actual runtime scale and target calibration')
        records.append(record)
        print(json.dumps({k:record[k] for k in ('action','decodedMiB','emptyFrames','minAlphaMargin','sourceKeysPreservedAtEvenFrames','gifClock')},ensure_ascii=False),flush=True)
    overview.save(ROOT/'previews/all-actions-fixed-root.png')
    manifest=dict(unitKey='pleat_devourer',stage='transparent_sprite_candidates_ready',
        acceptedAttackSource='../videos/attack-v04.mp4',userReply='可以，继续',
        approvedForRuntime=False,runtimeIntegrated=False,sourceScale=composition['sourceScale'],
        sourceOrigin=composition['sourceOrigin'],referenceCell=composition['referenceCell'],
        usageTier='specialist',targetMiB=64,admissionMiB=128,
        totalDecodedMiB=composition['gpuMiB'],dependencies=[],
        dependencyNote='Four animation sheets only. Gameplay, projectiles, summons and runtime entity do not yet exist; this is not a future gameplay dependency guarantee.',
        worldScale=None,normalZoomBodyPixels=None,maximumZoomBodyPixels=None,collider=None,
        timingPolicy='Source clocks retained; attack is not silently accelerated to 1500ms. One-shots include source last frame and its original remaining dwell.',
        motionPolicy=composition['motionPolicy'],actions=records,
        sourceSelection='selection.json',producer='produce-sprites.py',packager='finish-sprites.py',
        overview='previews/all-actions-fixed-root.png',
        testsRun=False,runtimeValidationRun=False,
        inspectionBoundary='Only asset-production frame statistics, generated previews and visual review; no tests, builds, browser or game checks.')
    proposals={}
    for record in records:
        layout=record['layout']
        proposals[record['action']]=dict(texture=record['sheet'],textureKey=record['textureKeyProposal'],
            columns=layout['columns'],rows=layout['rows'],frameWidth=layout['frameWidth'],frameHeight=layout['frameHeight'],
            frameCount=layout['frameCount'],endFrame=layout['endFrame'],footX=layout['footX'],footY=layout['footY'],
            originX=layout['footX']/layout['frameWidth'],originY=layout['footY']/layout['frameHeight'],
            duration=layout['durationMs'],frameDurations=layout['frameDurationsMs'],repeat=layout['repeat'])
    parameters=dict(status='proposal_not_registered',referenceCell=composition['referenceCell'],
        actions=proposals,collision=None,displaySize=None,attackReach=None,
        warning='Requires entity/loader integration and user visual acceptance; not an automatically consumed game config.')
    annotate_publication(manifest, parameters)
    write(ROOT/'sprite-manifest.json',manifest)
    write(ROOT/'animation-parameters.json',parameters)


if __name__=='__main__':
    main()
