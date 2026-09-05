"""Extract one H3 walk cycle with BiRefNet; keep output outside runtime assets."""
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
TOOLS = HERE.parent
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location("foreman_cutout", TOOLS / "_foreman_whip_doubao_20260831/build-candidate.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
from rmbg_cutout import get_model

for folder in ("source-keyframes/walk-v01", "sheets", "previews"):
    (HERE / folder).mkdir(parents=True, exist_ok=True)
with av.open(str(HERE / "videos/walk-v01.mp4")) as container:
    frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]

# Same-phase legs at source f26/f76; omit the duplicated ending pose.
indices = list(range(26, 76, 2))
model = None
cutouts = []
for index in [0] + indices:
    path = HERE / "source-keyframes/walk-v01" / f"{index:04d}.png"
    if path.exists():
        cutout = np.asarray(Image.open(path).convert("RGBA"))
    else:
        if model is None:
            model = get_model()
        cutout = helper.cutout(frames[index], model)
        Image.fromarray(cutout).save(path)
    cutouts.append(cutout)
    print(f"BiRefNet walk source frame {index}", flush=True)

# Only the neutral BODY defines scale. The held whip remains in every output.
body = helper.body_bounds(cutouts[0][..., 3])
scale = 268 / (body[3] - body[1])
root = [(body[0] + body[2]) / 2, body[3]]
transform = np.float32([[scale, 0, 512 - root[0] * scale], [0, scale, 512 - root[1] * scale]])
cells = []
for cutout in cutouts[1:]:
    premult = cutout.astype(np.float32)
    premult[..., :3] *= premult[..., 3:4] / 255
    result = cv2.warpAffine(premult, transform, (1024, 768), flags=cv2.INTER_LANCZOS4)
    alpha = np.clip(result[..., 3:4], 0, 255)
    result[..., :3] = np.clip(result[..., :3] * 255 / np.maximum(alpha, 1), 0, 255)
    result[..., 3:4] = alpha
    result[alpha[..., 0] < 3] = 0
    cells.append(result.astype(np.uint8))
boxes = [helper.bounds(cell[..., 3] > 2) for cell in cells]
half_width = math.ceil((max(max(512 - b[0], b[2] - 512) for b in boxes) + 8) / 8) * 8
top = math.floor((min(b[1] for b in boxes) - 8) / 8) * 8
bottom = math.ceil((max(b[3] for b in boxes) + 8) / 8) * 8
cells = [cell[top:bottom, 512-half_width:512+half_width] for cell in cells]
w, h = half_width * 2, bottom - top
count = len(cells) * 2
layouts = [(c, math.ceil(count/c)) for c in range(1, 4096//w+1) if math.ceil(count/c)*h <= 4096]
cols, rows = min(layouts, key=lambda pair: (pair[0]*pair[1], abs(pair[0]*w-pair[1]*h)))
sheet = Image.new("RGBA", (cols*w, math.ceil(len(cells)/cols)*h))
for index, cell in enumerate(cells):
    sheet.paste(Image.fromarray(cell), (index%cols*w, index//cols*h))
sheet.save(HERE / "sheets/walk-v01-base.png")
helper.save_gif([helper.checker(cell) for cell in cells], HERE / "previews/walk-v01-keyframes-1500ms.gif", 1500)
manifest = {
    "status": "candidate_not_installed", "provider": "minimax-h3-local",
    "sourceVideo": "videos/walk-v01.mp4", "sourceIndices": indices,
    "sourceCycle": {"start": 26, "endExclusive": 76, "samePhaseEnd": 76},
    "sourceNeutralBodyBBox": body, "sourceAnchor": root, "fixedScale": scale,
    "frameWidth": w, "frameHeight": h, "baseCols": cols, "baseFrameCount": len(cells),
    "finalCols": cols, "finalRows": rows, "finalFrameCount": count,
    "footX": half_width, "footY": 512-top, "referenceCell": 512, "displaySize": 480,
    "durationMs": 1500, "rifeInputFrameRate": len(cells)/1.5, "mode": "loop",
    "completeWhipRetained": True, "perFrameScaleOrCentering": False,
}
(HERE / "walk-v01-sheet-manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
print(json.dumps(manifest), flush=True)
