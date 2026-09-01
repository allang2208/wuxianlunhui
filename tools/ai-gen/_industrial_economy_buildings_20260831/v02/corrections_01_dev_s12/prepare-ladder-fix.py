"""One bounded stronger local correction after A/B retained the old edge ladder."""
import copy
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
OUT = ROOT / "ladder_fix"
OUT.mkdir(exist_ok=True)
manifest = copy.deepcopy(json.loads((ROOT / "correction-manifest.json").read_text(encoding="utf-8")))
manifest["outputRoot"] = OUT.relative_to(REPO).as_posix()
manifest["refineDepthStrength"] = .95
asset = next(a for a in manifest["assets"] if a["id"] == "oil_power_plant")
source = ROOT / "oil_power_plant/oil_power_plant_refine_v02_raw.png"
mask = Image.new("L", (1024, 1024), 0)
polygon = [(172, 236), (288, 236), (296, 650), (291, 735), (172, 719)]
ImageDraw.Draw(mask).polygon(polygon, fill=255)
mask_path = OUT / "chimney_ladder_mask.png"
mask.save(mask_path)
rgb = Image.open(source).convert("RGB")
Image.composite(Image.new("RGB", rgb.size, (245, 57, 79)), rgb,
                mask.point(lambda v: int(v * .38))).save(OUT / "chimney_ladder_mask_preview.png")
asset["maskedRefineRequest"] = (
    "two-storey fuel-oil power station matching the supplied image, with only its tall smokestack corrected. "
    "The smokestack is an OPEN HOLLOW cylinder with a thick ring rim and a clearly visible dark bore. "
    "One narrow dark iron maintenance ladder runs vertically down the CENTER of the visible front chimney wall, "
    "midway between the chimney's left and right outlines, exactly following the new Depth. "
    "The ladder's rails and every rung have solid gray masonry directly behind them. "
    "The ladder begins well BELOW the rim and has no hook or rail above the mouth. "
    "The chimney's right outline is bare continuous gray masonry with absolutely no ladder there and no protruding rung. "
    "Keep the same chimney height, open mouth, gray masonry and horizontal bands. "
    "No second ladder. No green anywhere between rungs. "
    "Outside this chimney mask preserve the source exactly, including both aligned storeys, the roof, all windows, "
    "open doorway, oil-drop/lightning plaque, two tanks and complete foundation. "
    "The small background portions inside the mask are uniform green with no shadow."
)
asset["maskImage"] = mask_path.relative_to(REPO).as_posix()
asset["maskRegions"] = [{"name": "chimney_only", "strength": 255, "polygon": polygon}]
asset["directCorrectionSource"] = source.relative_to(REPO).as_posix()
manifest["assets"] = [asset]
manifest["authorization"].update(generationSubmitted=False, generationCompleted=False, generatedCount=0,
    scope="One additional chimney-only 12-step correction after A/B did not move the ladder; same user-requested scope")
manifest["correctionRun"].update({
    "purpose": "Fix failed ladder relocation, not a whole-building redraw",
    "sourceImage": source.relative_to(REPO).as_posix(),
    "stepsOverride": 12, "denoiseOverride": .95, "depthStrength": .95,
    "variantsPerAsset": 1, "seedBases": {"oil_power_plant": 133161},
    "reason": "A/B retained original edge ladder; one bounded chimney-only stronger structural correction",
    "status": "prepared", "maximumAdditionalImages": 1,
})
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared one chimney-only correction from B")
