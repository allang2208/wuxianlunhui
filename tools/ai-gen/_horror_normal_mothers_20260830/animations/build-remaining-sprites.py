"""Three approved horror enemies: fixed-camera cutouts, adaptive keys, 2x RIFE.

Production only; no game/test/build commands. Originals and coffin ward stay intact.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import math
import subprocess
import sys

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parents[1]
BUILD = ROOT / "remaining-sprite-build-v01"
ACTORS = {"shroud-thrall": "裹尸囚徒", "ossuary-caster": "掷骨殓徒", "knell-attendant": "缚钟侍者"}
ACTIONS = ("idle", "walking", "attacking", "dying")
BODY_PX = 208
FORCE = False
APPROVAL = "用户：注意大小统一、优化插帧、接入游戏，参考其他同级怪物设计数值，完善动作状态机"
spec = importlib.util.spec_from_file_location("coffin_sprite_helpers", ROOT / "coffin-ward/build-sprites.py")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def frames(job):
    with av.open(str(ROOT / job["video"])) as container:
        return [f.to_image().convert("RGB") for f in container.decode(video=0)]


def proxy(im):
    gray = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
    mask = (gray < 185).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    main = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    mask = (labels == main).astype(np.float32)
    return cv2.resize(mask, (160, 160), interpolation=cv2.INTER_AREA)


def prepare():
    catalog = load(ROOT / "current-video-candidates.json")
    for actor in ACTORS:
        jobs = []
        for action in ACTIONS:
            src = next(j for j in catalog["jobs"] if j["asset"] == actor and j["action"] == action)
            job = {k: src[k] for k in ("asset", "action", "video", "preview")}
            ims = frames(job)
            count = len(ims)
            fps = 24
            group = "h3" if "h3-" in src["video"] else "doubao"
            step = 4 if action in ("idle", "dying") else 2
            start, end = 0, count
            candidates = []
            if action in ("idle", "walking"):
                silhouettes = [proxy(im) for im in ims]
                for s in range(12, 61, step):
                    for period in range(40 if action == "idle" else 24, 81 if action == "idle" else 61, step):
                        e = s + period
                        if e > count - 12:
                            continue
                        pose = float(np.abs(silhouettes[s] - silhouettes[e]).mean())
                        velocity = float(np.abs((silhouettes[s+step]-silhouettes[s])-(silhouettes[e]-silhouettes[e-step])).mean())
                        candidates.append(dict(start=s, endExclusive=e, period=period, score=pose + .35*velocity))
                candidates.sort(key=lambda c: c["score"])
                start, end = candidates[0]["start"], candidates[0]["endExclusive"]
                keys = list(range(start, end, step))
            elif action == "attacking":
                # 8fps for anticipation/recovery; 24fps keys for actual swing/release.
                # RIFE only fills between these authored poses; final clock is nonuniform.
                keys = sorted(set(range(0, count, 3)) | set(range(38, 57)) | {count-1})
                step = 3
            else:
                keys = sorted(set(range(0, count, step)) | {count-1})
            loop = action in ("idle", "walking")
            durations = []
            for i, key in enumerate(keys):
                if i+1 < len(keys):
                    interval = (keys[i+1]-key)*1000/fps
                elif loop:
                    interval = (end-key)*1000/fps
                else:
                    durations.append((count-key)*1000/fps)
                    break
                durations.extend([interval/2, interval/2])
            job.update(sourceFrameCount=count, sourceFps=fps, sourceSize=list(ims[0].size), sourceGroup=group,
                       sourceFrameIndices=keys, start=start, endExclusive=end, mode="loop" if loop else "one-shot",
                       keyFps=fps/step, frameDurationsMs=durations, frameCount=len(durations),
                       durationMs=sum(durations), cycleCandidates=candidates[:5])
            jobs.append(job)
            print("[selection]", actor, action, f"{start}:{end}, {len(keys)} keys -> {len(durations)} frames", flush=True)
        write(BUILD/actor/"selection.json", dict(actor=actor, approval=APPROVAL, preparedBodyHeightPx=BODY_PX,
              targetMiB=32, admissionMiB=64, sourcePolicy="Immutable videos; one fixed scale and origin per camera group, shared across actions. No per-frame fitting.", jobs=jobs))


def clean(rgb, alpha, preserve_dropped_dart=False):
    alpha = alpha.astype(np.uint8)
    mask = (alpha > 24).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = labels == largest
    if preserve_dropped_dart:
        x,y,w,h,_ = stats[largest]
        for i in range(1, n):
            px,py,pw,ph,area = stats[i]
            if area >= 16 and px < x+w+180 and px+pw > x-100 and py > y+h*.65 and py < y+h+40:
                keep |= labels == i
    keep = cv2.dilate(keep.astype(np.uint8), np.ones((3,3), np.uint8)) > 0
    alpha[(~keep) | (alpha <= 24)] = 0
    reliable = alpha >= 224
    _, near = distance_transform_edt(~reliable, return_indices=True)
    rgb = rgb.copy()
    edge = (alpha > 0) & ~reliable
    rgb[edge] = rgb[near[0][edge], near[1][edge]]
    rgb[alpha == 0] = 0
    return np.dstack((rgb, alpha))


def cutouts():
    # Reuse the same ComfyUI-RMBG backend as ai-asset.py cutout; one loaded model for the batch.
    sys.path.insert(0, str(TOOLS))
    from rmbg_cutout import get_model, predict_alpha
    model = get_model()
    for actor in ACTORS:
        for job in load(BUILD/actor/"selection.json")["jobs"]:
            ims = frames(job)
            keys = sorted({0} | set(job["sourceFrameIndices"]))
            dest = BUILD/actor/"cutouts"/job["action"]
            dest.mkdir(parents=True, exist_ok=True)
            for i,key in enumerate(keys):
                path = dest/f"f{key:03d}.png"
                if path.exists():
                    continue
                rgba = clean(np.asarray(ims[key]), predict_alpha(model, ims[key]), actor == "ossuary-caster" and job["action"] == "dying")
                Image.fromarray(rgba).save(path)
                if i%8 == 0 or i == len(keys)-1:
                    print("[cutout]", actor, job["action"], f"{i+1}/{len(keys)}", flush=True)


def get_cut(actor, action, index):
    im = Image.open(BUILD/actor/"cutouts"/action/f"f{index:03d}.png").convert("RGBA")
    if actor == "shroud-thrall" and action == "attacking":
        # The source overlay crosses the lowered hand. Only its bright lettering RGB
        # is reconstructed inside this fixed overlay ROI; alpha/geometry stay intact.
        rgba = np.asarray(im).copy()
        rgb = rgba[..., :3].copy()
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        mask = np.zeros(gray.shape, np.uint8)
        mask[670:702, 599:711] = ((gray[670:702, 599:711] > 165)
            & (rgba[670:702, 599:711, 3] > 24)).astype(np.uint8)*255
        mask = cv2.dilate(mask, np.ones((3,3), np.uint8))
        mask[rgba[...,3] == 0] = 0
        if mask.any():
            rgb = cv2.inpaint(rgb,mask,3,cv2.INPAINT_TELEA)
            rgba[..., :3] = rgb
            rgba[rgba[...,3] == 0, :3] = 0
            im = Image.fromarray(rgba, "RGBA")
    return im


def compose():
    for actor in ACTORS:
        selection = load(BUILD/actor/"selection.json")
        calibrations, records = {}, []
        for job in selection["jobs"]:
            group = job["sourceGroup"]
            if group not in calibrations:
                ref = get_cut(actor, job["action"], 0)
                box = ref.getchannel("A").getbbox()
                source_h = box[3]-box[1]
                # Foot-center origin is measured once, never recentered during animation.
                a = np.asarray(ref)[...,3]
                foot_band = max(14, round(source_h*.10))
                fy,fx = np.nonzero(a[max(0,box[3]-foot_band):box[3]] > 24)
                foot_x = float((fx.min()+fx.max())/2)
                calibrations[group] = dict(referenceAction=job["action"], bodyBox=list(box), sourceBodyHeightPx=source_h,
                                           sourceOrigin=[foot_x, box[3]-1], scale=BODY_PX/source_h)
            cal = calibrations[group]
            scale = cal["scale"]
            origin_x, origin_y = cal["sourceOrigin"]
            cells, boxes = [], []
            for key in job["sourceFrameIndices"]:
                im = get_cut(actor,job["action"],key)
                size = (round(im.width*scale),round(im.height*scale))
                im = im.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")
                cells.append(np.asarray(im).copy())
                boxes.append(im.getchannel("A").getbbox())
            x = origin_x*scale
            radius = math.ceil(max(max(x-b[0], b[2]-x) for b in boxes))+6
            left = math.floor(x-radius)
            top = min(b[1] for b in boxes)-6
            bottom = max(b[3] for b in boxes)+6
            width,height = radius*2, bottom-top
            cropped = []
            for im in cells:
                out = np.zeros((height,width,4),np.uint8)
                x0,y0,x1,y1 = max(0,left),max(0,top),min(im.shape[1],left+width),min(im.shape[0],bottom)
                out[y0-top:y1-top,x0-left:x1-left] = im[y0:y1,x0:x1]
                out[out[...,3]==0,:3] = 0
                cropped.append(out)
            key_cols,key_rows = helpers.layout(len(cropped),width,height)
            cols,rows = helpers.layout(job["frameCount"],width,height)
            sheet = BUILD/actor/"source-sheets"/f"{job['action']}.png"
            helpers.pack(cropped,key_cols,sheet)
            record = {**job, "frameWidth":width,"frameHeight":height,"footX":x-left,"footY":origin_y*scale-top,
                      "cropScaled":[left,top,left+width,bottom], "sourceScale":scale,
                      "sourceKeyCount":len(cropped),"sourceCols":key_cols,"sourceRows":key_rows,
                      "cols":cols,"rows":rows,"endFrame":job["frameCount"]-1,
                      "sourceSheet":sheet.relative_to(ROOT).as_posix(),
                      "rgbaMiB":cols*width*rows*height*4/1048576}
            records.append(record)
            print("[pack]",actor,job["action"],f"{width}x{height} x {job['frameCount']} = {record['rgbaMiB']:.2f}MiB",flush=True)
        total = sum(r["rgbaMiB"] for r in records) + (.25 if actor == "ossuary-caster" else 0)
        if total > 64:
            raise RuntimeError(f"{actor} exceeds crowd admission: {total:.2f}MiB; adjust before interpolation")
        write(BUILD/actor/"source-manifest.json",{**selection,"calibrations":calibrations,"actions":records,"estimatedRgbaMiB":total})


def interpolate():
    for actor in ACTORS:
        for r in load(BUILD/actor/"source-manifest.json")["actions"]:
            out = BUILD/actor/"spritesheets"/f"{r['action']}.png"
            report = BUILD/actor/"reports"/f"{r['action']}-rife.json"
            if out.exists() and report.exists() and not FORCE:
                continue
            report.parent.mkdir(parents=True, exist_ok=True)
            cmd = [sys.executable,str(TOOLS/"rife-spritesheet-interpolate.py"),"--sheet",str(ROOT/r["sourceSheet"]),
                   "--out",str(out),"--name",f"{actor}-{r['action']}","--frame-width",str(r["frameWidth"]),
                   "--frame-height",str(r["frameHeight"]),"--cols",str(r["sourceCols"]),"--frame-count",str(r["sourceKeyCount"]),
                   "--frame-rate",str(r["keyFps"]),"--mode",r["mode"],"--out-cols",str(r["cols"]),
                   "--preview-dir",str(BUILD/actor/"previews/rife"),"--report",str(report),
                   "--repair-red-outliers","--hold-large-repair"]
            if r["action"] == "dying":
                cmd.append("--preserve-vertical-motion")
            print("[RIFE]",actor,r["action"],flush=True)
            with report.with_suffix(".log").open("w",encoding="utf-8") as log:
                subprocess.run(cmd,check=True,stdout=log,stderr=subprocess.STDOUT)


def finish():
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",16)
    labels = dict(idle="待机",walking="行走",attacking="攻击",dying="死亡")
    for actor in ACTORS:
        manifest = load(BUILD/actor/"source-manifest.json")
        sequences = {}
        for r in manifest["actions"]:
            path = BUILD/actor/"spritesheets"/f"{r['action']}.png"
            im = np.asarray(Image.open(path).convert("RGBA"))
            w,h,c = r["frameWidth"],r["frameHeight"],r["cols"]
            cells = [im[i//c*h:(i//c+1)*h,i%c*w:(i%c+1)*w].copy() for i in range(r["frameCount"])]
            sequences[r["action"]] = cells
            gif = BUILD/actor/"previews/final"/f"{r['action']}.gif"
            gif_ms = helpers.save_preview(cells,r["frameDurationsMs"],gif)
            report = load(BUILD/actor/"reports"/f"{r['action']}-rife.json")
            r.update(sheet=path.relative_to(ROOT).as_posix(),gif=gif.relative_to(ROOT).as_posix(),gifDurationMs=gif_ms,
                     repeat=-1 if r["mode"]=="loop" else 0,originalKeyOutputIndices=list(range(0,r["frameCount"],2)),
                     intrinsicProductionMetrics=report["validation"],nominalOutputFps=r["keyFps"]*2)
        panels=[]
        for frame in range(124):
            panel=Image.new("RGB",(720,680),(30,33,39)); draw=ImageDraw.Draw(panel)
            for k,r in enumerate(manifest["actions"]):
                t=frame/24*1000
                if r["repeat"] == -1: t%=r["durationMs"]
                starts=np.cumsum([0]+r["frameDurationsMs"][:-1])
                idx=min(r["endFrame"],int(np.searchsorted(starts,t,side="right")-1))
                cell=helpers.checker(sequences[r["action"]][max(0,idx)])
                x,y=(k%2)*360,(k//2)*340
                panel.paste(cell,(x+(360-cell.width)//2,y+38+(280-cell.height)//2))
                draw.text((x+12,y+8),f"{ACTORS[actor]} · {labels[r['action']]}",font=font,fill="white")
            panels.append(panel)
        overview=BUILD/actor/"previews/final/four-actions.gif"
        panels[0].save(overview,save_all=True,append_images=panels[1:],duration=helpers.gif_durations([1000/24]*124),loop=0,disposal=2,optimize=False)
        panels[0].save(overview.with_suffix(".png"))
        manifest.update(status="sprites_ready_for_authorized_integration",overviewGif=overview.relative_to(ROOT).as_posix(),
                        testsRun=False,runtimeVerified=False,frameClock="frameDurationsMs is authoritative; dense release keys retain source timing.")
        write(BUILD/actor/"sprite-manifest.json",manifest)
        print("[finished]",actor,round(manifest["estimatedRgbaMiB"],2),"MiB",flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser=argparse.ArgumentParser()
    parser.add_argument("stage",choices=("prepare","cutouts","compose","interpolate","finish","produce"))
    parser.add_argument("--force",action="store_true",help="Regenerate derived interpolation after an explicit preparation change")
    args=parser.parse_args()
    FORCE=args.force
    if (BUILD/"runtime-manifest.json").exists():
        raise SystemExit("This revision is installed. Rebuild in a new revision; preserve current runtime sheets and tuning.")
    if args.stage == "produce":
        for stage in (prepare,cutouts,compose,interpolate,finish): stage()
    else:
        globals()[args.stage]()
