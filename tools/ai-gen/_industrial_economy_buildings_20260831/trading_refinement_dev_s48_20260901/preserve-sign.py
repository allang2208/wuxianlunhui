"""Restore the approved sign face only; keep both untouched AI raws separately."""
from pathlib import Path
import json

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "trading_sign_alien_20260901/trading_company_alien_sign_raw.png"
MASK = HERE.parent / "trading_sign_alien_20260901/sign-mask.png"
source = Image.open(SOURCE).convert("RGB")
mask = Image.open(MASK).convert("L")
source_array = np.asarray(source)
mask_array = np.asarray(mask)
records = []
for variant in (1, 2):
    raw_rel = f"trading_company/trading_company_refine_v{variant:02d}_raw.png"
    output_rel = f"trading_company/trading_company_refine_v{variant:02d}_sign_preserved.png"
    raw = Image.open(HERE / raw_rel).convert("RGB")
    if raw.size != source.size or raw.size != mask.size:
        raise SystemExit("Full source, raw and sign mask dimensions must agree")
    output = Image.composite(source, raw, mask)
    output.save(HERE / output_rel)
    raw_array, output_array = np.asarray(raw), np.asarray(output)
    changed = np.any(raw_array != output_array, axis=2)
    ys, xs = np.where(changed)
    records.append({
        "variant": variant,
        "generatedRaw": raw_rel,
        "generationMetadata": raw_rel.replace("_raw.png", "_generation.json"),
        "output": output_rel,
        "changedPixelCount": int(changed.sum()),
        "changedBBox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1] if len(xs) else None,
        "outsideSignMaskChangedPixels": int(np.count_nonzero(changed & (mask_array == 0))),
        "opaqueSignMaskPixelsDifferentFromAcceptedSource": int(np.count_nonzero(np.any(output_array != source_array, axis=2) & (mask_array == 255))),
        "size": list(output.size), "mode": output.mode,
        "generatedRawOverwritten": False,
        "transparentFinishingPerformed": False,
        "runtimeInstalled": False
    })
provenance = {
    "acceptedSignSource": "../trading_sign_alien_20260901/trading_company_alien_sign_raw.png",
    "signMask": "../trading_sign_alien_20260901/sign-mask.png",
    "acceptedSourceProvenance": "../trading_sign_alien_20260901/provenance.json",
    "reason": "Both full-image48 outputs can redraw fictional glyphs despite the prompt; protect the user-approved sign without rerolling or changing the building",
    "operation": "PIL.Image.composite accepted source sign onto each48 raw through the existing antialiased sign-face mask; all raw pixels outside the mask stay unchanged",
    "outputsAreCompositedDerivatives": True,
    "records": records
}
(HERE / "sign-preservation-provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(provenance, ensure_ascii=False))
