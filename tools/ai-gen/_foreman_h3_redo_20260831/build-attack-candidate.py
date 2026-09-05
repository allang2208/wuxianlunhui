"""Full-whip H3 attack candidate with the walk's fixed body scale and root."""
from pathlib import Path
import importlib.util
import json
import math
import sys
import av
import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
if (HERE / 'rejected-assets.json').exists():
    raise SystemExit('Attack v02 was rejected and archived. Use the approved v04 installer or create a new version.')
TOOLS = HERE.parent
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location("foreman_cutout", TOOLS / "_foreman_whip_doubao_20260831/build-candidate.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
from rmbg_cutout import get_model

for folder in ("source-keyframes/attack-v02", "sheets", "previews"):
    (HERE / folder).mkdir(parents=True, exist_ok=True)
walk = json.loads((HERE / "walk-v01-sheet-manifest.json").read_text(encoding="utf-8"))
scale, root = walk["fixedScale"], walk["sourceAnchor"]
# Keep the dense lash phase; omit two near-static samples (4 and 92) so the
# complete 704px whip cells fit a <=4096px page without shrinking the body.
indices = [0, 8, 12, 16, 20, 24, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 52, 56, 60, 64, 68, 72, 80, 123]
with av.open(str(HERE / "videos/attack-v02.mp4")) as container:
    frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
model = None
cells = []
transform = np.float32([[scale, 0, 512-root[0]*scale], [0, scale, 600-root[1]*scale]])
for index in indices:
    cached = HERE / "source-keyframes/attack-v02" / f"{index:04d}.png"
    if cached.exists():
        cutout = np.asarray(Image.open(cached).convert("RGBA"))
    else:
        if model is None:
            model = get_model()
        cutout = helper.cutout(frames[index], model)
        Image.fromarray(cutout).save(cached)
    # No actor_only mask and no whip length normalization: keep the source cord.
    premult = cutout.astype(np.float32)
    premult[..., :3] *= premult[..., 3:4] / 255
    result = cv2.warpAffine(premult, transform, (1536, 1024), flags=cv2.INTER_LANCZOS4)
    alpha = np.clip(result[..., 3:4], 0, 255)
    result[..., :3] = np.clip(result[..., :3] * 255 / np.maximum(alpha, 1), 0, 255)
    result[..., 3:4] = alpha
    result[alpha[..., 0] < 3] = 0
    cells.append(result.astype(np.uint8))
    print(f"BiRefNet attack source frame {index}", flush=True)

boxes = [helper.bounds(cell[..., 3] > 2) for cell in cells]
# One shared asymmetric crop keeps the long lash without wasted left margins.
# footX carries the same physical mirror root; the body is never re-centered.
left = math.floor((min(b[0] for b in boxes)-8)/8)*8
right = math.ceil((max(b[2] for b in boxes)+8)/8)*8
top = math.floor((min(b[1] for b in boxes)-8)/8)*8
bottom = math.ceil((max(b[3] for b in boxes)+8)/8)*8
cells = [cell[top:bottom, left:right] for cell in cells]
w, h, count = right-left, bottom-top, len(cells)*2-1
layouts = [(c, math.ceil(count/c)) for c in range(1, 4096//w+1) if math.ceil(count/c)*h <= 4096]
if not layouts:
    raise ValueError(f"Full whip needs a new packing decision: {count} frames, {w}x{h}")
cols, rows = min(layouts, key=lambda pair: (pair[0]*pair[1], abs(pair[0]*w-pair[1]*h)))
sheet = Image.new("RGBA", (cols*w, math.ceil(len(cells)/cols)*h))
for index, cell in enumerate(cells):
    sheet.paste(Image.fromarray(cell), (index%cols*w, index//cols*h))
sheet.save(HERE / "sheets/attack-v02-base.png")

# Candidate presentation only; runtime damage/AI remain untouched.
stages = [(0, 0), (28, 400), (48, 700), (80, 1250), (123, 1380)]
def source_time(index):
    for (a, ta), (b, tb) in zip(stages, stages[1:]):
        if index <= b:
            return ta + (tb-ta)*(index-a)/(b-a)
    return stages[-1][1]
key_times = [source_time(index) for index in indices]
times = []
for index in range(len(key_times)-1):
    times.extend((key_times[index], (key_times[index]+key_times[index+1])/2))
times.append(key_times[-1])
durations = [times[i+1]-times[i] for i in range(len(times)-1)] + [1500-times[-1]]
manifest = {
    "status": "candidate_not_installed", "provider": "minimax-h3-local",
    "sourceVideo": "videos/attack-v02.mp4", "sourceIndices": indices,
    "sourceAnchor": root, "fixedScale": scale, "scaleSource": "walk-v01-sheet-manifest.json",
    "frameWidth": w, "frameHeight": h, "baseCols": cols, "baseFrameCount": len(cells),
    "finalCols": cols, "finalRows": rows, "finalFrameCount": count,
    "footX": 512-left, "footY": 600-top, "referenceCell": 512, "displaySize": 480,
    "durationMs": 1500, "frameDurations": durations,
    "rifeInputFrameRate": count/3, "mode": "one-shot",
    "completeWhipRetained": True, "perFrameScaleOrCentering": False,
    "notes": ["Full source whip retained; no independent curve substituted.",
              "Presentation timing only; runtime contact/aim/clock integration pending."],
}
(HERE / "attack-v02-sheet-manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
print(json.dumps({k:manifest[k] for k in ("frameWidth","frameHeight","baseCols","baseFrameCount","finalCols","finalRows","finalFrameCount","footX","footY")}), flush=True)
