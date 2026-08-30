#!/usr/bin/env python3
"""Offline, task-local production of the eight user-approved mine animations.

Uses the shared ComfyUI-RMBG module and RIFE CLI; never writes runtime assets.
All actions share one fixed transform per monster. Source poses are not warped.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parents[1]
BUILD = ROOT / "sprite-build"
ASSETS = ("core-drill-larva", "ore-shardling")
STATES = ("idle", "walking", "attacking", "dying")
LABELS = ("待命", "移动", "攻击 · 单次", "死亡 · 单次")
sys.path.insert(0, str(TOOLS))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def decode(asset, state):
    path = ROOT / asset / "videos" / f"{state}-doubao-v01.mp4"
    with av.open(str(path)) as video:
        stream = video.streams.video[0]
        fps = float(stream.average_rate)
        frames = [np.asarray(frame.to_image().convert("RGB")) for frame in video.decode(stream)]
    if fps != 24 or len(frames) != 121 or frames[0].shape != (720, 1280, 3):
        raise RuntimeError(f"Unexpected approved input: {path}")
    return frames


def proxy(rgb):
    """Rough source-only pose comparison, NEVER the delivered transparency."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    mask = gray < 200
    image = np.where(mask, gray, 240).astype(np.uint8)
    return cv2.resize(image, (320, 180), interpolation=cv2.INTER_AREA).astype(np.float32)


def delta(a, b):
    mask = (a < 210) | (b < 210)
    return float(np.abs(a-b)[mask].mean()) if mask.any() else 0.0


def prepare():
    BUILD.mkdir(parents=True, exist_ok=True)
    suggestions = {}
    for asset in ASSETS:
        for state in STATES:
            frames = decode(asset, state)
            reference_dir = BUILD / asset / "references"
            reference_dir.mkdir(parents=True, exist_ok=True)
            Image.fromarray(frames[0]).save(reference_dir / f"{state}-f000.png")
            if state not in ("idle", "walking"):
                continue
            small = [proxy(frame) for frame in frames]
            rows = []
            for start in range(16, 61, 2):
                for period in range(36, 85, 2):
                    end = start + period
                    if end > 106:
                        continue
                    endpoint = delta(small[start], small[end])
                    seam = delta(small[end-2], small[start])
                    typical = float(np.median([delta(small[i], small[i+2]) for i in range(start, end-2, 2)]))
                    velocity = delta(small[start+2]-small[start]+128, small[end+2]-small[end]+128)
                    rows.append({"start":start, "endpointExcluded":end, "period":period,
                                 "poseDelta":round(endpoint,4), "seamDelta":round(seam,4),
                                 "typicalAdjacentDelta":round(typical,4),
                                 "velocityDelta":round(velocity,4),
                                 "score":round(endpoint+0.2*seam+0.5*velocity,4)})
            rows.sort(key=lambda row:row["score"])
            key = f"{asset}/{state}"
            suggestions[key] = rows[:20]
            contact = Image.new("RGB", (1280, 4*202), "#20242a")
            draw = ImageDraw.Draw(contact)
            for rank, row in enumerate(rows[:4]):
                for col, index in enumerate((row["start"], row["start"]+2, row["endpointExcluded"]-2, row["endpointExcluded"])):
                    contact.paste(Image.fromarray(frames[index]).resize((320,180)), (col*320,rank*202))
                    draw.text((col*320+5,rank*202+184), f"candidate {rank+1} / f{index} / score {row['score']}", fill="white")
            contact.save(reference_dir / f"{state}-cycle-candidates.png")
            print(key, json.dumps(rows[:3]), flush=True)
    write_json(BUILD / "cycle-candidates.json", suggestions)


def bbox(rgba, threshold=24):
    ys,xs=np.where(rgba[...,3]>threshold)
    if not len(xs):
        raise RuntimeError("Empty foreground")
    return tuple(map(int,(xs.min(),ys.min(),xs.max()+1,ys.max()+1)))


def clean_cutout(rgb, alpha):
    """Keep legitimate disconnected rock debris; remove faint background islands."""
    alpha=np.squeeze(np.asarray(alpha))
    if alpha.max(initial=0)<=1.5:
        alpha=alpha*255
    alpha=np.clip(alpha,0,255).astype(np.uint8)
    if alpha.shape!=rgb.shape[:2]:
        alpha=cv2.resize(alpha,(rgb.shape[1],rgb.shape[0]))
    count, labels, stats, _=cv2.connectedComponentsWithStats((alpha>24).astype(np.uint8),8)
    if count<2:
        raise RuntimeError("Empty BiRefNet mask")
    main=1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))
    x,y,w,h,_=stats[main]
    keep=labels==main
    # Debris is part of the approved death, not noise. Keep nearby solid islands.
    for component in range(1,count):
        cx,cy,cw,ch,area=stats[component]
        if area>=12 and cx<x+w+128 and cx+cw>x-128 and cy<y+h+96 and cy+ch>y-96:
            keep|=labels==component
    alpha[~keep]=0
    alpha[alpha<=24]=0
    reliable=alpha>=224
    if not reliable.any():
        raise RuntimeError("No opaque body")
    clean=rgb.copy()
    edge=(alpha>0)&~reliable
    nearest=distance_transform_edt(~reliable,return_distances=False,return_indices=True)
    clean[edge]=rgb[nearest[0][edge],nearest[1][edge]]
    clean[alpha==0]=0
    return np.dstack((clean,alpha))


def selection():
    return json.loads((BUILD/"selection.json").read_text(encoding="utf-8"))


def cutouts():
    from rmbg_cutout import get_model,predict_alpha
    specs=selection()
    model=None
    for asset in ASSETS:
        for state in STATES:
            spec=specs[asset][state]
            indices=sorted(set([0]+list(range(spec["start"],spec["endExclusive"],2))))
            frames=decode(asset,state)
            dest=BUILD/asset/"cutouts"/state
            dest.mkdir(parents=True,exist_ok=True)
            for n,index in enumerate(indices):
                path=dest/f"f{index:03d}.png"
                if not path.exists():
                    if model is None:
                        model=get_model()
                    rgba=clean_cutout(frames[index],predict_alpha(model,Image.fromarray(frames[index])))
                    Image.fromarray(rgba,"RGBA").save(path)
                if n%10==0 or n+1==len(indices):
                    print(f"[BiRefNet] {asset}/{state} {n+1}/{len(indices)} source f{index}",flush=True)


def checker(rgba):
    yy,xx=np.indices(rgba.shape[:2])
    gray=np.where(((xx//24+yy//24)%2)[...,None],58,82)
    bg=np.repeat(gray,3,axis=2)
    a=rgba[...,3:4].astype(np.float32)/255
    return Image.fromarray(np.clip(rgba[...,:3]*a+bg*(1-a),0,255).astype(np.uint8))


def gif_timing(count,fps):
    # GIF has 10 ms ticks. Distribute rounding, rather than making 24 fps into 25.
    bounds=[round(i*100/fps) for i in range(count+1)]
    return [(bounds[i+1]-bounds[i])*10 for i in range(count)]


def previews(cells,path,fps,label,indices=None):
    path.parent.mkdir(parents=True,exist_ok=True)
    width=480
    height=round(cells[0].shape[0]*width/cells[0].shape[1])
    gif=[checker(cell).resize((width,height),Image.Resampling.LANCZOS) for cell in cells]
    gif[0].save(path.with_suffix(".gif"),save_all=True,append_images=gif[1:],duration=gif_timing(len(gif),fps),loop=0,disposal=2,optimize=False)
    chosen=sorted(set(round(i*(len(cells)-1)/23) for i in range(24)))
    tile_w=320
    tile_h=round(cells[0].shape[0]*tile_w/cells[0].shape[1])
    contact=Image.new("RGB",(tile_w*4,(tile_h+24)*math.ceil(len(chosen)/4)),"#20242a")
    draw=ImageDraw.Draw(contact)
    for pos,i in enumerate(chosen):
        x=pos%4*tile_w;y=pos//4*(tile_h+24)
        contact.paste(checker(cells[i]).resize((tile_w,tile_h),Image.Resampling.LANCZOS),(x,y))
        source=f" / source f{indices[i]}" if indices else (" key" if i%2==0 else " RIFE")
        draw.text((x+4,y+tile_h+4),f"{label} f{i}{source}",fill="white")
    contact.save(path.parent/f"{path.name}-contact.png")


def compose():
    specs=selection()
    records=[]
    for asset in ASSETS:
        ref=np.asarray(Image.open(BUILD/asset/"cutouts/idle/f000.png").convert("RGBA"))
        x0,y0,x1,y1=bbox(ref)
        solid=(ref[...,3]>128).astype(np.uint8)
        if asset=="core-drill-larva":
            thickness=float(cv2.distanceTransform(solid,cv2.DIST_L2,5).max()*2)
            scale=150/thickness
            ref_x=(x0+x1)/2
            metric={"method":"maximum inscribed body diameter; drill/tail excluded", "sourceBodyThickness":thickness,"targetBodyThickness":150}
        else:
            # Main broad head/torso starts where alpha row width exceeds 40%
            # of maximum; the solitary narrow back spike above is excluded.
            row_width=solid.sum(axis=1)
            body_top=int(np.flatnonzero(row_width>=row_width.max()*0.4)[0])
            body_height=y1-body_top
            scale=300/body_height
            low=np.where(solid[round(body_top+body_height*0.7):y1])
            ref_x=float(np.median(low[1]))
            metric={"method":"broad body rows excluding narrow back spine", "sourceBodyTop":body_top,"sourceBodyHeight":body_height,"targetBodyHeight":300}
        ref_ground=y1-1
        source_sets={}
        extents=[]
        for state in STATES:
            spec=specs[asset][state]
            indices=list(range(spec["start"],spec["endExclusive"],2))
            frames=[np.asarray(Image.open(BUILD/asset/"cutouts"/state/f"f{i:03d}.png").convert("RGBA")) for i in indices]
            source_sets[state]=(indices,frames)
            extents.extend([bbox(frame) for frame in frames])
        half_width=max(max(ref_x-b[0],b[2]-ref_x)*scale for b in extents)
        frame_width=max(512,math.ceil((2*half_width+48)/128)*128)
        top_extent=max((ref_ground-b[1])*scale for b in extents)
        foot_y=max(432,math.ceil((top_extent+32)/16)*16)
        bottom_extent=max((b[3]-ref_ground)*scale for b in extents)
        frame_height=max(512,math.ceil((foot_y+bottom_extent+32)/128)*128)
        transform={"scale":scale,"sourceAnchorX":ref_x,"sourceGroundY":ref_ground,"anchorX":frame_width/2,"footY":foot_y,"frameWidth":frame_width,"frameHeight":frame_height,"metric":metric,"policy":"One constant transform for all four actions; preserves source translation, recoil and collapse; no per-frame scaling or recentering."}
        write_json(BUILD/asset/"transform.json",transform)
        print(asset,json.dumps(transform),flush=True)
        for state,(indices,frames) in source_sets.items():
            cells=[]
            bboxes=[]
            for rgba in frames:
                bx,by,ex,ey=bbox(rgba)
                crop=Image.fromarray(rgba[by:ey,bx:ex],"RGBA")
                crop=crop.resize((max(1,round((ex-bx)*scale)),max(1,round((ey-by)*scale))),Image.Resampling.LANCZOS)
                ox=round(frame_width/2+(bx-ref_x)*scale)
                oy=round(foot_y+(by-ref_ground)*scale)
                if min(ox,oy,frame_width-ox-crop.width,frame_height-oy-crop.height)<16:
                    raise RuntimeError(f"Unsafe cell boundary: {asset}/{state}")
                cell=np.zeros((frame_height,frame_width,4),np.uint8)
                cell[oy:oy+crop.height,ox:ox+crop.width]=np.asarray(crop)
                cell[cell[...,3]==0,:3]=0
                cells.append(cell)
                bboxes.append(bbox(cell))
            cols=min(8,8192//frame_width,len(cells))
            rows=math.ceil(len(cells)/cols)
            sheet=np.zeros((rows*frame_height,cols*frame_width,4),np.uint8)
            for i,cell in enumerate(cells):
                x=i%cols*frame_width;y=i//cols*frame_height
                sheet[y:y+frame_height,x:x+frame_width]=cell
            out=BUILD/asset/"source-sheets-pre-interpolation"/f"{state}.png"
            out.parent.mkdir(parents=True,exist_ok=True)
            Image.fromarray(sheet,"RGBA").save(out)
            previews(cells,BUILD/asset/"previews/source"/state,12,state,indices)
            record={"asset":asset,"state":state,"sourceVideo":f"{asset}/videos/{state}-doubao-v01.mp4","sourceFrameIndices":indices,"sourceFrameRate":24,"sourceSampleStep":2,"frameRate":12,"frameCount":len(cells),"cols":cols,"rows":rows,"mode":"loop" if state in ("idle","walking") else "one-shot","sheet":out.relative_to(ROOT).as_posix(),"transform":transform,"bboxes":bboxes,"selection":specs[asset][state]}
            records.append(record)
            print(f"[source sheet] {asset}/{state}: {len(cells)} cells {frame_width}x{frame_height}",flush=True)
    write_json(BUILD/"source-manifest.json",{"runtimeIntegrationActive":False,"actions":records})


def interpolate():
    manifest=json.loads((BUILD/"source-manifest.json").read_text(encoding="utf-8"))
    for rec in manifest["actions"]:
        asset,state=rec["asset"],rec["state"]
        target=BUILD/asset/"spritesheets"/f"{state}.png"
        report=BUILD/asset/"reports/rife"/f"{state}.json"
        if target.exists() and report.exists():
            print(f"[RIFE cached] {asset}/{state}",flush=True)
            continue
        width,height=rec["transform"]["frameWidth"],rec["transform"]["frameHeight"]
        final_count=rec["frameCount"]*2-(rec["mode"]=="one-shot")
        out_cols=max(rec["cols"],math.ceil(final_count/(8192//height)))
        if out_cols*width>8192:
            raise RuntimeError(f"Final sheet exceeds texture limit: {asset}/{state}")
        cmd=[sys.executable,str(TOOLS/"rife-spritesheet-interpolate.py"),"--sheet",str(ROOT/rec["sheet"]),"--out",str(target),"--name",f"{asset}-{state}","--frame-width",str(width),"--frame-height",str(height),"--cols",str(rec["cols"]),"--frame-count",str(rec["frameCount"]),"--frame-rate","12","--mode",rec["mode"],"--out-cols",str(out_cols),"--preview-dir",str(BUILD/asset/"previews/rife"),"--report",str(report),"--repair-red-outliers","--preserve-vertical-motion"]
        # Purple crystals are intentional: never enable magenta/blue despill.
        print(f"[RIFE begin] {asset}/{state}",flush=True)
        subprocess.run(cmd,check=True)


def finish():
    source=json.loads((BUILD/"source-manifest.json").read_text(encoding="utf-8"))
    actions=[]
    overview={asset:[] for asset in ASSETS}
    for rec in source["actions"]:
        asset,state=rec["asset"],rec["state"]
        report_path=BUILD/asset/"reports/rife"/f"{state}.json"
        report=json.loads(report_path.read_text(encoding="utf-8"))
        count=rec["frameCount"]*2-(rec["mode"]=="one-shot")
        path=BUILD/asset/"spritesheets"/f"{state}.png"
        sheet=np.asarray(Image.open(path).convert("RGBA"))
        w,h=rec["transform"]["frameWidth"],rec["transform"]["frameHeight"]
        cols=report["cols"]
        cells=[sheet[i//cols*h:(i//cols+1)*h,i%cols*w:(i%cols+1)*w].copy() for i in range(count)]
        previews(cells,BUILD/asset/"previews/final"/state,24,state)
        overview[asset].append(cells)
        checks=report["validation"]
        if (checks["emptyFrames"] or checks["touchingFrames"]
                or not checks["originalKeyFramesPreservedAtEvenIndices"]
                or checks["nonzeroRgbInTransparentPixels"]
                or checks["visibleDarkOutlierFrames"] or checks["visibleRedOutlierFrames"]
                or checks["middleFrameHeldSourceKeyFallbacks"]):
            raise RuntimeError(f"Sprite production gate needs review: {asset}/{state}")
        record={"asset":asset,"state":state,"sheet":path.relative_to(ROOT).as_posix(),"sourceVideo":rec["sourceVideo"],"frameWidth":w,"frameHeight":h,"cols":cols,"rows":math.ceil(count/cols),"frameCount":count,"startFrame":0,"endFrame":count-1,"frameRate":24,"repeat":-1 if rec["mode"]=="loop" else 0,"loop":rec["mode"]=="loop","anchorX":rec["transform"]["anchorX"],"footY":rec["transform"]["footY"],"origin":[rec["transform"]["anchorX"]/w,rec["transform"]["footY"]/h],"sourceFrameIndices":rec["sourceFrameIndices"],"originalKeyOutputIndices":list(range(0,count,2)),"gif":(BUILD/asset/"previews/final"/f"{state}.gif").relative_to(ROOT).as_posix(),"rifeReport":report_path.relative_to(ROOT).as_posix(),"pixelProductionReport":checks,"sourceApprovedByUser":True,"finalSpriteApprovedByUser":False,"runtimeIntegrationActive":False}
        if state=="dying":
            record["corpseFrame"]=count-1
            record["holdLastFrameOnCompletion"]=True
        record["durationSeconds"]=count/24
        record["previewPlaybackNote"]="GIF repeats for inspection only; one-shot attacks and deaths must not loop in-game."
        actions.append(record)
    font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",22)
    small=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",16)
    for asset,sequences in overview.items():
        panels=[]
        for n in range(122):
            canvas=Image.new("RGB",(960,824),"#20242a")
            draw=ImageDraw.Draw(canvas)
            for k,cells in enumerate(sequences):
                i=n%len(cells) if k<2 else min(n,len(cells)-1)
                tile=checker(cells[i]);tile.thumbnail((480,360),Image.Resampling.LANCZOS)
                x=k%2*480;y=k//2*412
                canvas.paste(tile,(x+(480-tile.width)//2,y+40))
                draw.text((x+18,y+8),LABELS[k],font=font,fill="white")
                draw.text((x+18,y+386),f"24 fps | {len(cells)} 帧 | {i}",font=small,fill="#bac6d2")
            panels.append(canvas)
        out=BUILD/asset/"previews/final/four-actions-overview.gif"
        panels[0].save(out,save_all=True,append_images=panels[1:],duration=gif_timing(len(panels),24),loop=0,disposal=2,optimize=False)
        panels[0].save(out.with_suffix(".png"))
    write_json(BUILD/"sprite-manifest.json",{"task":"abandoned-mine-two-normal-monsters","sourceApproval":"User: 可用，做成精灵图","pipeline":"ComfyUI-RMBG BiRefNet-general + fixed per-monster transform + RIFE v4.6 RGBA 2x","runtimeIntegrationActive":False,"gameTestsRun":False,"runtimeVerificationRun":False,"actions":actions})
    task_index=json.loads((ROOT/"task-index.json").read_text(encoding="utf-8"))
    integrated=task_index.get("runtimeIntegrationActive",False)
    if not integrated:
        task_index["status"]="eight-spritesheets-delivered-not-runtime-integrated"
        task_index["spritesheetStage"]="rife-2x-completed-pending-user-visual-acceptance"
    if not integrated:
        task_index["spriteManifest"]="sprite-build/sprite-manifest.json"
    for job in task_index["jobs"]:
        final=next(row for row in actions if row["asset"]==job["asset"] and row["state"]==job["state"])
        if not integrated:
            job.update({"status":"source-approved-spritesheet-delivered","approved":True,"spritesheet":final["sheet"],"spritePreview":final["gif"],"spriteFrameCount":final["frameCount"],"spriteFrameRate":24})
    task_index["reviewSummary"]["sourceAcceptance"]="All eight source videos accepted by user; historical review notes retained as provenance."
    if not integrated:
        task_index["reviewSummary"]["downstreamWorkDeferred"]=["User visual acceptance of transparent sprite sheets","Runtime configuration and gameplay integration, not requested in this turn"]
    write_json(ROOT/"task-index.json",task_index)
    print(json.dumps([{k:r[k] for k in ("asset","state","frameWidth","frameHeight","frameCount","frameRate")} for r in actions],ensure_ascii=False),flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("stage",choices=("prepare","cutouts","compose","interpolate","finish"))
    args=parser.parse_args()
    globals()[args.stage]()
