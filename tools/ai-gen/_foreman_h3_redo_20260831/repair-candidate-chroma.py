"""Remove unsupported red/purple flecks from this candidate's RIFE middles only."""
from pathlib import Path
import json
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
selected = sys.argv[1:] or ["walk-v01"]
report_path = ROOT / "candidate-chroma-repair.json"
previous = json.loads(report_path.read_text()) if report_path.exists() else []
reports = [entry for entry in previous if entry["action"] not in selected]
for action in selected:
    manifest = json.loads((ROOT / f"{action}-sheet-manifest.json").read_text())
    if manifest.get("status") == "rejected_archived_metadata_only":
        raise SystemExit(f"{action} was rejected; see rejected-assets.json.")
    if manifest.get("assetApproved"):
        raise SystemExit(f"{action} is approved; chroma repair precedes native midpoint restoration and must not be rerun.")
    w, h, cols, count = [manifest[k] for k in ("frameWidth", "frameHeight", "finalCols", "finalFrameCount")]
    path = ROOT / "sheets" / f"{action}-rife.png"
    sheet = np.array(Image.open(path).convert("RGBA"))
    def frame(index):
        x, y = index % cols * w, index // cols * h
        return sheet[y:y+h, x:x+w]
    repaired_counts = {}
    for index in range(1, count, 2):
        first = frame(index-1)
        second = frame((index+1) % count)
        middle = frame(index)
        # The default general-purpose gate ignores translucent pixels and
        # permits red anywhere within 31px of a wound. Thin whip/hand flecks
        # need a tighter local comparison on these two brown/ochre assets.
        def solid_rgb(source):
            # Tiny low-alpha RGB edge fringes must not become the colour donor
            # for a newly opaque interpolated hand/whip pixel.
            solid = source[..., 3] >= 192
            _, nearest = ndimage.distance_transform_edt(~solid, return_indices=True)
            return source[nearest[0], nearest[1], :3].astype(np.int16)
        first_rgb = solid_rgb(first)
        second_rgb = solid_rgb(second)
        rgb = middle[..., :3].astype(np.int16)
        def red(rgb):
            return rgb[..., 0] - np.maximum(rgb[..., 1], rgb[..., 2])
        def purple(rgb):
            return np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
        allowed_red = np.maximum(ndimage.maximum_filter(red(first_rgb), size=9), ndimage.maximum_filter(red(second_rgb), size=9))
        allowed_purple = np.maximum(ndimage.maximum_filter(purple(first_rgb), size=9), ndimage.maximum_filter(purple(second_rgb), size=9))
        suspect = (middle[..., 3] > 3) & (
            ((red(rgb) > 28) & (red(rgb) > allowed_red + 8))
            | ((purple(rgb) > 22) & (purple(rgb) > allowed_purple + 8))
        )
        # Use neighbouring source colours; alpha and the interpolated motion
        # remain untouched, as do every original (even-indexed) key frame.
        source_rgb = np.rint((first_rgb.astype(np.float32) + second_rgb) * .5).astype(np.uint8)
        middle[..., :3][suspect] = source_rgb[suspect]
        if suspect.any():
            repaired_counts[index] = int(suspect.sum())
    Image.fromarray(sheet).save(path)
    reports.append({"action": action, "modifiedMiddlePixels": repaired_counts,
                    "originalKeysChanged": False, "alphaChanged": False,
                    "description": "Candidate-local low-alpha temporal chroma repair; source keys and RIFE motion preserved."})
report_path.write_text(json.dumps(reports, indent=2)+"\n")
print(json.dumps(reports))
