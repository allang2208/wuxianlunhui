"""Prefer an exact source-video midpoint over an inferred RIFE midpoint when available."""
from pathlib import Path
import importlib.util
import json
import sys
import av
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
action = "attack-v04"
manifest_path = ROOT / f"{action}-sheet-manifest.json"
manifest = json.loads(manifest_path.read_text())
if manifest.get("assetApproved"):
    raise SystemExit("Approved v04 already includes the native midpoint repairs; do not process it again.")
w, h, cols = [manifest[k] for k in ("frameWidth","frameHeight","finalCols")]
scale, anchor = manifest["fixedScale"], manifest["sourceAnchor"]
matrix = np.float32([[scale, 0, manifest["footX"]-anchor[0]*scale],
                     [0, scale, manifest["footY"]-anchor[1]*scale]])
sheet_path = ROOT / "sheets" / f"{action}-rife.png"
sheet = np.array(Image.open(sheet_path).convert("RGBA"))
sys.path.insert(0, str(ROOT.parent))
spec = importlib.util.spec_from_file_location("foreman_cutout", ROOT.parent / "_foreman_whip_doubao_20260831/build-candidate.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
from rmbg_cutout import get_model
with av.open(str(ROOT / "videos" / f"{action}.mp4")) as container:
    frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
model, mapping = None, {}
indices = manifest["sourceIndices"]
for pair, (first, second) in enumerate(zip(indices, indices[1:])):
    if (first+second)%2:
        continue
    source = (first+second)//2
    cached = ROOT / "source-keyframes" / action / f"{source:04d}.png"
    if cached.exists():
        rgba = np.array(Image.open(cached).convert("RGBA"))
    else:
        if model is None:
            model = get_model()
        rgba = helper.cutout(frames[source], model)
        Image.fromarray(rgba).save(cached)
    premult = rgba.astype(np.float32)
    premult[..., :3] *= premult[..., 3:4]/255
    cell = cv2.warpAffine(premult, matrix, (w,h), flags=cv2.INTER_LANCZOS4)
    alpha = np.clip(cell[..., 3:4],0,255)
    cell[..., :3] = np.clip(cell[..., :3]*255/np.maximum(alpha,1),0,255)
    cell[..., 3:4] = alpha
    cell[alpha[..., 0] < 3] = 0
    output = pair*2+1
    x,y = output%cols*w, output//cols*h
    sheet[y:y+h,x:x+w] = cell.astype(np.uint8)
    mapping[output] = source
    print(f"Exact source midpoint: output {output} <- video frame {source}", flush=True)
Image.fromarray(sheet).save(sheet_path)
manifest["nativeSourceMidpointOverrides"] = mapping
manifest["retainedNativeFrameCount"] = len(indices)+len(mapping)
manifest["remainingRifeMiddleCount"] = len(indices)-1-len(mapping)
manifest["postprocessOrder"] = ["RIFE from base", "middle chroma repair", "exact native source midpoints", "final previews"]
manifest_path.write_text(json.dumps(manifest, indent=2)+"\n")
print(f"Kept {len(indices)+len(mapping)} native video frames and {len(indices)-1-len(mapping)} RIFE half-steps; timing unchanged.", flush=True)
