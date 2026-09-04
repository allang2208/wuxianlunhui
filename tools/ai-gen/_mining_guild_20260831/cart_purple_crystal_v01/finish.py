"""Composite the generated cargo patch without changing accepted02 elsewhere."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
base_path = ROOT / "accepted_48_v02/mining_guild.png"
raw_path = HERE / "candidates/mining_guild/mining_guild_refine_v01_raw.png"
crop_box = (74, 232, 951, 923)
base = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
base.paste(Image.open(base_path).convert("RGBA"), crop_box[:2])
generated = Image.open(raw_path).convert("RGB")
mask = Image.open(HERE / "cargo_mask.png").convert("L")
# Restrain the generated near-white highlights and neon saturation on crystals
# only. Brown cart pixels and the rest of the accepted scene are not recolored.
rgb = np.asarray(generated).astype(np.float32)
crystal = ((rgb[:, :, 0] > rgb[:, :, 1] + 3)
           & (rgb[:, :, 2] > rgb[:, :, 1] + 5)
           & (rgb[:, :, 2] >= rgb[:, :, 0] * 0.88)
           & (np.asarray(mask) > 0))
crystal |= ((rgb.min(axis=2) > 150)
            & (rgb.max(axis=2) - rgb.min(axis=2) < 50)
            & (np.asarray(mask) > 0))
hsv = np.asarray(generated.convert("HSV")).copy()
source_hue = np.where(hsv[:, :, 1][crystal] < 25, 198, hsv[:, :, 0][crystal])
hsv[:, :, 0][crystal] = np.rint(source_hue * 0.5 + 198 * 0.5).astype(np.uint8)
hsv[:, :, 1][crystal] = np.rint(np.maximum(hsv[:, :, 1][crystal] * 0.82, 66)).astype(np.uint8)
hsv[:, :, 2][crystal] = np.rint(hsv[:, :, 2][crystal] * 0.82).astype(np.uint8)
toned = np.asarray(Image.fromarray(hsv, "HSV").convert("RGB"))
toned_rgb = np.asarray(generated).copy()
toned_rgb[crystal] = toned[crystal]
generated = Image.fromarray(toned_rgb)
generated.save(HERE / "cargo_toned_generated.png")
# Feather only inside the selected region: no outside pixel enters the composite.
blend_mask = ImageChops.multiply(mask, mask.filter(ImageFilter.GaussianBlur(0.45)))
blend_mask.save(HERE / "cargo_composite_mask.png")
composite = Image.composite(generated, base.convert("RGB"), blend_mask).convert("RGBA")
composite.putalpha(base.getchannel("A"))
final = composite.crop(crop_box)
final.save(HERE / "mining_guild.png")

preview = Image.new("RGBA", final.size, (54, 58, 64, 255))
draw = ImageDraw.Draw(preview)
for y in range(0, final.height, 24):
    for x in range(0, final.width, 24):
        if (x // 24 + y // 24) % 2:
            draw.rectangle((x, y, x + 23, y + 23), fill=(63, 67, 73, 255))
preview.alpha_composite(final)
preview.convert("RGB").save(HERE / "mining_guild_preview.png")
composite.crop((410, 678, 589, 824)).resize((716, 584), Image.Resampling.LANCZOS).save(HERE / "cart_after_detail.png")

generation = json.loads((HERE / "candidates/mining_guild/mining_guild_refine_v01_generation.json").read_text(encoding="utf-8"))
manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
provenance = {
    "assetId": "mining_guild",
    "status": "selected02_purple_crystal_cargo_revision_delivered",
    "userRequest": manifest["authorization"]["userRequest"],
    "baseSelectedVariant": 2, "baseSelectedSeed": 132352,
    "acceptedSource": "../accepted_48_v02/mining_guild.png",
    "directCompositeBase": "../accepted_48_v02/mining_guild.png",
    "acceptedSourceProvenance": "../accepted_48_v02/provenance.json",
    "rawGenerationInput": "../candidates_03A_dev_s48/mining_guild/mining_guild_refine_v02_raw.png",
    "depthInput": "../mining_guild_body_depth.png",
    "sourceModel": "../mining_guild_model.blend",
    "modelModified": False,
    "generationManifest": "manifest.json",
    "generatedRaw": raw_path.relative_to(HERE).as_posix(),
    "generationMetadata": "candidates/mining_guild/mining_guild_refine_v01_generation.json",
    "actualPrompt": "candidates/mining_guild/mining_guild_refine_prompt.txt",
    "crystalToneFinish": {
        "source": "candidates/mining_guild/mining_guild_refine_v01_raw.png",
        "output": "cargo_toned_generated.png",
        "scope": "Only purple-biased cargo pixels and near-white crystal highlights inside the mask; no cart recolor",
        "hue8bit": "0.5*sourceHue + 0.5*198; near-neutral highlights use sourceHue198", "saturation8bit": "max(sourceSaturation*0.82, 66)",
        "valueMultiplier": 0.82,
        "reason": "Keep crystal faces wholly violet while reducing neon saturation and near-white highlights to match the accepted building",
    },
    "generationParameters": {k: generation.get(k) for k in ("model", "seed", "steps", "denoise", "depthStrength", "cfg", "sampler", "scheduler", "localMaskedRefine", "nonstandardOverride")},
    "mask": "cargo_mask.png", "polygonFullCanvas": manifest["localEdit"]["polygon"],
    "composite": {
        "method": "Generated RGB cargo patch over accepted02, feather0.45px clipped inside cargo mask; original Alpha is copied verbatim",
        "blendMask": "cargo_composite_mask.png",
        "fullCanvasMaskBox": list(mask.getbbox()),
        "cropBox": list(crop_box), "outputSize": list(final.size),
        "outsideMaskPreservedByConstruction": True,
        "sourceAlphaPreservedByConstruction": True,
        "subjectWideRecolor": False,
    },
    "artwork": "mining_guild.png", "preview": "mining_guild_preview.png",
    "cargoDetail": "cart_after_detail.png",
    "preserved": ["cart frame and wheels", "rails", "building and foundation", "assay table and its original samples", "emblem and pennant", "accepted02 original files"],
    "runtimeInstalled": False, "runtimeCalibrationPerformed": False,
    "testsAndRuntimeVerification": "Not run; user performs testing per project agreement",
}
(HERE / "provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"output": str(HERE / "mining_guild.png"), "size": final.size, "alphaCopiedFrom": str(base_path)}, ensure_ascii=False))
