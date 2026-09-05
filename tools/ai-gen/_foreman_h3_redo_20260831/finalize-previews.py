"""Render candidate GIFs using their declared presentation clocks, not debug holds."""
from pathlib import Path
from bisect import bisect_right
import json
import sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
selected = sys.argv[1:] or ["walk-v01", "attack-v04"]
summary_path = ROOT / "candidate-summary.json"
previous = json.loads(summary_path.read_text()) if summary_path.exists() else []
outputs = [entry for entry in previous if entry["action"] not in selected]
for action in selected:
    manifest_path = ROOT / f"{action}-sheet-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("status") == "rejected_archived_metadata_only":
        raise SystemExit(f"{action} was rejected; see rejected-assets.json.")
    sheet = Image.open(ROOT / "sheets" / f"{action}-rife.png").convert("RGBA")
    w,h,cols,count = [manifest[k] for k in ("frameWidth","frameHeight","finalCols","finalFrameCount")]
    yy,xx = np.indices((h,w))
    background = np.where(((xx//16+yy//16)%2)[...,None],64,82)
    images = []
    for i in range(count):
        cell = np.asarray(sheet.crop((i%cols*w,i//cols*h,i%cols*w+w,i//cols*h+h)))
        alpha = cell[...,3:4].astype(np.float32)/255
        images.append(Image.fromarray(np.clip(cell[...,:3]*alpha+background*(1-alpha),0,255).astype(np.uint8)))
    durations = manifest.get("frameDurations",[manifest["durationMs"]/count]*count)
    elapsed, rounded, gif_ms = 0,0,[]
    for duration in durations:
        elapsed += duration
        next_rounded = round(elapsed/10)*10
        gif_ms.append(next_rounded-rounded)
        rounded = next_rounded
    gif = ROOT / "previews" / f"{action}-candidate-1500ms.gif"
    gif_images = images
    if min(gif_ms) < 20:
        # Some GIF viewers clamp very short delays. Sample the same timeline
        # at 50fps so a fast strike cannot turn into a sequence of long holds.
        starts = [0]
        for duration in durations[:-1]:
            starts.append(starts[-1]+duration)
        gif_images = [images[bisect_right(starts, t)-1] for t in range(0, round(sum(durations)), 20)]
        gif_ms = [20]*len(gif_images)
        gif_ms[-1] = round(sum(durations))-20*(len(gif_images)-1)
        manifest["gifPreviewSamplingFps"] = 50
    gif_images[0].save(gif,save_all=True,append_images=gif_images[1:],duration=gif_ms,loop=0,disposal=2)
    samples = list(range(count))
    thumb_w = 352 if action.startswith("attack") else 216
    thumb_h = round(h*thumb_w/w)
    grid = Image.new("RGB",(5*thumb_w,((len(samples)+4)//5)*(thumb_h+24)),"#1d252d")
    draw = ImageDraw.Draw(grid)
    time_ms=0
    for slot,i in enumerate(samples):
        x,y=slot%5*thumb_w,slot//5*(thumb_h+24)
        grid.paste(images[i].resize((thumb_w,thumb_h),Image.Resampling.LANCZOS),(x,y+24))
        draw.text((x+7,y+6),f"f{i:02d} / {time_ms:.0f}ms",fill="white")
        time_ms += durations[i]
    grid.save(ROOT / "previews" / f"{action}-candidate-frames.png")
    manifest["preview"] = str(gif.relative_to(ROOT)).replace("\\","/")
    manifest["sheet"] = f"sheets/{action}-rife.png"
    manifest["rgbaMiB"] = sheet.width*sheet.height*4/1048576
    manifest_path.write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    outputs.append({"action":action,"frameCount":count,"durationMs":sum(gif_ms),"sheetMiB":manifest["rgbaMiB"],"preview":manifest["preview"],
                    "status":manifest["status"],"runtimeIntegrationActive":manifest.get("runtimeIntegrationActive",False)})
summary_path.write_text(json.dumps(outputs,indent=2)+"\n",encoding="utf-8")
print(json.dumps(outputs))
