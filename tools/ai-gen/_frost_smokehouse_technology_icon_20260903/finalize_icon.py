"""Convert the selected cold-smoking badge raw into the runtime technology icon."""
import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
shared = runpy.run_path(str(ROOT.parent / "_royal_mint_icons_20260824/finalize_icons.py"))
source_path = ROOT / "raw/cold_smoking.png"
runtime_path = PROJECT / "assets/ui/technology-icons/cold_smoking.png"

source = Image.open(source_path)
cutout = shared["cut_badge"](source, "checker", "hex")
final = shared["normalize"](cutout, 1024, 1000)
pixels = np.asarray(final).copy()
pixels[pixels[:, :, 3] == 0, :3] = 0
final = Image.fromarray(pixels, "RGBA")
runtime_path.parent.mkdir(parents=True, exist_ok=True)
final.save(runtime_path, optimize=True)

alpha = np.asarray(final.getchannel("A"))
record = {
    "assetId": "cold_smoking",
    "source": "raw/cold_smoking.png",
    "sourceMode": source.mode,
    "sourceSize": list(source.size),
    "backgroundHandling": "deterministic pointed-hex geometry mask over baked checkerboard",
    "runtime": "assets/ui/technology-icons/cold_smoking.png",
    "runtimeMode": final.mode,
    "runtimeSize": list(final.size),
    "alphaExtrema": [int(alpha.min()), int(alpha.max())],
    "alphaBBox": list(final.getchannel("A").getbbox()),
    "cornerAlpha": [
        int(alpha[0, 0]), int(alpha[0, -1]),
        int(alpha[-1, 0]), int(alpha[-1, -1]),
    ],
    "transparentPixelsWithRgb": int(np.count_nonzero(
        (alpha == 0) & np.any(np.asarray(final)[:, :, :3] != 0, axis=2)
    )),
}
(ROOT / "runtime-metadata.json").write_text(
    json.dumps(record, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
print(json.dumps(record, ensure_ascii=False, indent=2))
