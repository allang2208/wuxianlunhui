"""Build only the reviewed impact redo; original walk and v02 stay untouched."""
from pathlib import Path
import importlib.util
import json
import math
import sys
import av
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
spec = importlib.util.spec_from_file_location("foreman_cutout", ROOT.parent / "_foreman_whip_doubao_20260831/build-candidate.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
from rmbg_cutout import get_model

selection = json.loads((ROOT / "attack-impact-selection.json").read_text())
action, indices = selection["action"], selection["sourceIndices"]
if selection.get("assetApproved"):
    raise SystemExit("Approved pixels are frozen. Use install-approved-attack.py; create a new version for further generation.")
walk = json.loads((ROOT / "walk-v01-sheet-manifest.json").read_text())
scale, anchor = walk["fixedScale"], walk["sourceAnchor"]
cache = ROOT / "source-keyframes" / action
cache.mkdir(parents=True, exist_ok=True)
with av.open(str(ROOT / "videos" / f"{action}.mp4")) as container:
    frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
matrix = np.float32([[scale, 0, 768-anchor[0]*scale], [0, scale, 640-anchor[1]*scale]])
model, cells = None, []
for index in indices:
    path = cache / f"{index:04d}.png"
    if path.exists():
        rgba = np.array(Image.open(path).convert("RGBA"))
    else:
        if model is None:
            model = get_model()
        rgba = helper.cutout(frames[index], model)
        Image.fromarray(rgba).save(path)
    premult = rgba.astype(np.float32)
    premult[..., :3] *= premult[..., 3:4]/255
    cell = cv2.warpAffine(premult, matrix, (2048, 1152), flags=cv2.INTER_LANCZOS4)
    alpha = np.clip(cell[..., 3:4], 0, 255)
    cell[..., :3] = np.clip(cell[..., :3]*255/np.maximum(alpha, 1), 0, 255)
    cell[..., 3:4] = alpha
    cell[alpha[..., 0] < 3] = 0
    cells.append(cell.astype(np.uint8))
    print(f"Cutout {action}: source {index}", flush=True)

boxes = [helper.bounds(cell[..., 3] > 2) for cell in cells]
half_width = math.ceil((max(768-min(b[0] for b in boxes), max(b[2] for b in boxes)-768)+8)/8)*8
left, right = 768-half_width, 768+half_width
top = math.floor((min(b[1] for b in boxes)-8)/8)*8
bottom = math.ceil((max(b[3] for b in boxes)+8)/8)*8
cells = [cell[top:bottom, left:right] for cell in cells]
w, h, count = right-left, bottom-top, len(cells)*2-1
layouts = [(cols, math.ceil(count/cols)) for cols in range(1,4096//w+1) if math.ceil(count/cols)*h <= 4096]
if not layouts:
    raise ValueError(f"Choose a source sampling layout for full whip: {count} frames of {w}x{h}")
cols, rows = min(layouts, key=lambda pair: (pair[0]*pair[1], abs(pair[0]*w-pair[1]*h)))
sheet = Image.new("RGBA", (cols*w, math.ceil(len(cells)/cols)*h))
for i, cell in enumerate(cells):
    sheet.paste(Image.fromarray(cell), (i%cols*w, i//cols*h))
sheet.save(ROOT / "sheets" / f"{action}-base.png")

stages = selection["presentationStages"]
def source_time(index):
    for (a, ta), (b, tb) in zip(stages, stages[1:]):
        if index <= b:
            return ta+(tb-ta)*(index-a)/(b-a)
    return stages[-1][1]
key_times = [source_time(index) for index in indices]
times = []
for first, second in zip(key_times, key_times[1:]):
    times.extend((first, (first+second)/2))
times.append(key_times[-1])
total = selection["durationMs"]
manifest = {
    "status": "candidate_not_installed", "provider": "minimax-h3-local",
    "sourceVideo": f"videos/{action}.mp4", "sourceIndices": indices,
    "sourceAnchor": anchor, "fixedScale": scale, "scaleSource": "walk-v01-sheet-manifest.json",
    "frameWidth": w, "frameHeight": h, "baseCols": cols, "baseFrameCount": len(cells),
    "finalCols": cols, "finalRows": rows, "finalFrameCount": count,
    "footX": half_width, "footY": 640-top, "referenceCell": 512, "displaySize": 480,
    "durationMs": total, "presentationStages": stages,
    "frameDurations": [b-a for a,b in zip(times,times[1:])]+[total-times[-1]],
    "rifeInputFrameRate": count/(total/1000)/2, "mode": "one-shot",
    "completeWhipRetained": True, "perFrameScaleOrCentering": False,
    "notes": selection["notes"] + ["Symmetric common horizontal crop; native body movement preserved.",
                                  "Candidate presentation only; no runtime or gameplay change."]
}
(ROOT / f"{action}-sheet-manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
print(json.dumps({k:manifest[k] for k in ("frameWidth","frameHeight","baseCols","baseFrameCount","finalCols","finalRows","finalFrameCount","footX","footY")}), flush=True)
