"""Prepare approved zombie-dog sources and immutable local integration baseline."""
from pathlib import Path
import json
import shutil
import av
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
VIDEOS = ROOT.parent / "videos"
REPO = ROOT.parents[4]
for name in ("references","contacts","before","cutouts","keys","final","previews","reports"):
    (ROOT/name).mkdir(parents=True, exist_ok=True)
for relative in ("src/entities/enemy-types.js","src/phaser/scenes/BootScene.js","data/enemy-config.json","public/data/enemy-config.json"):
    dest = ROOT/"before"/relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        shutil.copy2(REPO/relative,dest)
cfg = json.loads((REPO/"data/enemy-config.json").read_text(encoding="utf-8"))["zombieDog"]
old = Image.open(REPO/cfg["textures"]["idle"]).convert("RGBA").crop((0,0,512,512))
old.save(ROOT/"references/previous-runtime-idle-frame-00.png")
box=old.getchannel("A").getbbox()
calibration=dict(previousConfig=cfg, oldIdleAlphaBox=box, previousReferenceCell=512,
    referenceCell=256, preparedBodyHeight=(box[3]-box[1])/2,
    profile="crowd", targetMiB=32, admissionMiB=64, maxTextureSide=4096,
    policy="One fixed source pixel scale shared by four approved videos; source motion preserved; no per-frame resizing.")
(ROOT/"calibration.json").write_text(json.dumps(calibration,ensure_ascii=False,indent=2),encoding="utf-8")
def decode(action):
    with av.open(str(VIDEOS/f"zombie-dog-{action}-doubao-v01.mp4")) as c:
        return [f.to_image().convert("RGB") for f in c.decode(video=0)]
def silhouette(im):
    rgb=np.asarray(im)
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    mask=(gray<155).astype(np.uint8)
    n,lab,stats,_=cv2.connectedComponentsWithStats(mask,8)
    main=1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))
    return cv2.resize((lab==main).astype(np.float32),(256,144),interpolation=cv2.INTER_AREA)
def contact(images, indices, path, cols=6):
    w,h=320,180
    canvas=Image.new("RGB",(cols*w,((len(indices)+cols-1)//cols)*(h+20)),(230,230,230))
    draw=ImageDraw.Draw(canvas)
    for slot,index in enumerate(indices):
        x,y=slot%cols*w,slot//cols*(h+20)
        canvas.paste(images[index].resize((w,h)),(x,y))
        draw.text((x+5,y+h+3),f"f{index:03d}  {index/24:.3f}s",fill=(0,0,0))
    canvas.save(path)
selections={}
for action in ("idle","running","attack","dying"):
    images=decode(action)
    images[0].save(ROOT/"references"/f"{action}-source-f000.png")
    if action in ("idle","running"):
        masks=[silhouette(im) for im in images]
        candidates=[]
        starts=range(12,53,2) if action=="idle" else range(26,64)
        periods=range(40,85,2) if action=="idle" else range(12,25)
        for start in starts:
            for period in periods:
                end=start+period
                if end>108 if action=="idle" else end>93:
                    continue
                pose=np.abs(masks[start]-masks[end])
                legs=pose[70:126].mean()
                delta=(masks[start+1]-masks[start])-(masks[end+1]-masks[end])
                score=float(pose.mean()+.8*legs+.3*np.abs(delta).mean())
                candidates.append(dict(start=start,endExclusive=end,period=period,score=score))
        candidates.sort(key=lambda x:x["score"])
        top=candidates[:5]
        picks=[v for candidate in top for v in (candidate["start"],candidate["start"]+candidate["period"]//2,candidate["endExclusive"]-1,candidate["endExclusive"])]
        contact(images,picks,ROOT/"contacts"/f"{action}-cycle-candidates.png",4)
        selections[action]=dict(candidates=top)
    else:
        picks=list(range(45,67)) if action=="attack" else list(range(0,65,3))+[120]
        contact(images,picks,ROOT/"contacts"/f"{action}-source-detail.png",6)
(ROOT/"selection-candidates.json").write_text(json.dumps(selections,indent=2),encoding="utf-8")
print(json.dumps({"calibration":{k:v for k,v in calibration.items() if k!="previousConfig"},"cycles":selections},ensure_ascii=False))
