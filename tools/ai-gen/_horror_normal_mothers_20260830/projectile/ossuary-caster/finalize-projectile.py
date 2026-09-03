"""Export the generated dart with the standard BiRefNet mask; candidates only."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
manifest_path = ROOT / "projectile-manifest.json"
if manifest_path.exists() and json.loads(manifest_path.read_text(encoding="utf-8")).get("runtimeIntegrationActive"):
    raise RuntimeError("Already integrated; preserve the selected projectile and runtime manifest instead of recreating a candidate.")
rgb = np.asarray(Image.open(ROOT / "bone-dart-source-v02.png").convert("RGB")).copy()
alpha = np.asarray(Image.open(ROOT / "bone-dart-mask-v01.png").convert("L")).copy()
alpha[alpha <= 8] = 0
rgb[alpha == 0] = 0
source = Image.fromarray(np.dstack((rgb, alpha)), "RGBA")
source.save(ROOT / "bone-dart-transparent-v01.png")
bounds = source.getchannel("A").getbbox()
crop = source.crop(bounds)
factor = 224 / max(crop.size)
size = tuple(max(1, round(v * factor)) for v in crop.size)
# Premultiplied-alpha resizing prevents dark fringes; no shape or RGB repaint.
sprite = crop.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")
canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
offset = ((256 - size[0]) // 2, (256 - size[1]) // 2)
canvas.paste(sprite, offset)
pixels = np.asarray(canvas).copy()
pixels[pixels[..., 3] == 0, :3] = 0
canvas = Image.fromarray(pixels, "RGBA")
canvas.save(ROOT / "bone-dart-256-v01.png", optimize=True)

report = {
    "asset": "ossuary-caster/bone-dart", "status": "candidate_awaiting_user_selection",
    "assetOnly": True, "runtimeIntegrationActive": False,
    "generator": "built-in image_gen", "reference": "../../mother/03-ossuary-caster-v02.png",
    "source": "bone-dart-source-v02.png", "sourceAncestor": "bone-dart-source-v01.png",
    "prompts": ["prompt-v01.txt", "prompt-v02-alpha.txt"],
    "generationFiles": [
        "C:/Users/allan/.codex/generated_images/01a050f5-cf67-7012-b82a-6534d2e91b0e/exec-58d980f7-ce45-41d0-8e42-a4ad67908a6c.png",
        "C:/Users/allan/.codex/generated_images/01a050f5-cf67-7012-b82a-6534d2e91b0e/exec-4ca4048a-912d-462e-aae1-b1e82be72592.png"
    ],
    "cutout": {"entrypoint": "tools/ai-gen/ai-asset.py cutout", "model": "BiRefNet-general", "mask": "bone-dart-mask-v01.png", "alphaCutoff": 8},
    "transparentSource": "bone-dart-transparent-v01.png", "output": "bone-dart-256-v01.png",
    "canvas": [256, 256], "contentBounds": list(canvas.getchannel("A").getbbox()),
    "sourceContentBounds": list(bounds), "contentSize": list(size), "tipDirection": "right",
    "origin": [0.5, 0.5], "axis": "+X", "rotationOffsetRadians": 0,
    "transparentPixels": int((pixels[..., 3] == 0).sum()),
    "notes": ["Both imagegen outputs were RGB; transparency comes from the separate BiRefNet mask.", "One static projectile; no baked trail, glow, spin or motion blur.", "No attack-animation, combat, config, or runtime asset changes.", "Display size, release anchor and flight behavior remain for later integration; this is not runtime acceptance."]
}
(ROOT / "projectile-manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"output": report["output"], "canvas": report["canvas"], "contentBounds": report["contentBounds"], "transparentPixels": report["transparentPixels"]}))
