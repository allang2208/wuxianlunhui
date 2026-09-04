"""Keep original gear geometry and apply bounded RGB material corrections only."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
manifest = json.loads((ROOT / "candidate-manifest-local-v1.json").read_text(encoding="utf-8"))
selection_path = ROOT / "local-review-selection.json"
selection = json.loads(selection_path.read_text(encoding="utf-8"))
parser = argparse.ArgumentParser()
parser.add_argument("--only", nargs="*", default=None)
args = parser.parse_args()

for asset in manifest["assets"]:
    if args.only and asset["id"] not in args.only:
        continue
    choice = selection[asset["id"]]
    stem = f"{asset['id']}_refine_v{choice['candidate']:02d}"
    folder = ROOT / "local_repair_v1" / asset["id"]
    source_path = REPO / asset["selectedRefineImage"]
    input_path = ROOT / choice["repairInput"] if choice.get("repairInput") else folder / (stem + "_local_raw.png")
    source = Image.open(source_path).convert("RGB")
    result = Image.open(input_path).convert("RGB")
    gear_box = next(shape for name, shape in asset["maskRegions"] if name == "gear")
    gear_region = Image.new("L", source.size, 0)
    ImageDraw.Draw(gear_region).ellipse(gear_box, fill=255)
    # Restore source teeth, relief, and contact shading before adjusting RGB.
    result = Image.composite(source, result, gear_region)
    hue, saturation, value = source.convert("HSV").split()
    hue_weight = hue.point(lambda p: max(0, min(255, (p-17)*51, (52-p)*36)))
    saturation_weight = saturation.point(lambda p: max(0, min(255, (p-65)*5)))
    gold_mask = ImageChops.multiply(gear_region, ImageChops.multiply(hue_weight, saturation_weight))
    bronze = ImageEnhance.Brightness(ImageEnhance.Color(source).enhance(.65)).enhance(.72)
    result = Image.composite(bronze, result, gold_mask)
    gear_mask_path = folder / (stem + "_gear_grade_mask.png")
    gold_mask.save(gear_mask_path)
    notes = [{"region": "original gear only", "source": source_path.relative_to(REPO).as_posix(),
              "mask": gear_mask_path.relative_to(REPO).as_posix(), "saturationFactor": .65,
              "brightnessFactor": .72, "geometry": "original source gear restored; RGB-only grading"}]
    if asset["id"] == "engineer_camp":
        upright = Image.new("L", source.size, 0)
        polygon = [(589,657),(610,646),(610,783),(601,789),(589,782)]
        ImageDraw.Draw(upright).polygon(polygon, fill=255)
        upright = ImageChops.multiply(upright, upright.filter(ImageFilter.GaussianBlur(.65)))
        red, green, blue = result.split()
        warm_timber = Image.merge("RGB", (red.point(lambda p: min(255, round(p*1.12))),
                                          green.point(lambda p: round(p*.78)),
                                          blue.point(lambda p: round(p*.49))))
        result = Image.composite(warm_timber, result, upright)
        upright_path = folder / (stem + "_upright_grade_mask.png")
        upright.save(upright_path)
        notes.append({"region": "right hoist upright", "polygon": polygon,
                      "mask": upright_path.relative_to(REPO).as_posix(),
                      "rgbFactors": [1.12,.78,.49], "geometry": "unchanged"})
    final = folder / (stem + "_finished_raw.png")
    result.save(final)
    metadata = folder / (stem + "_finished_metadata.json")
    metadata.write_text(json.dumps({"input": input_path.relative_to(REPO).as_posix(),
        "inputMetadata": (ROOT / choice["repairInputMetadata"]).relative_to(REPO).as_posix() if choice.get("repairInputMetadata") else (folder / (stem + "_local_metadata.json")).relative_to(REPO).as_posix(),
        "original48": source_path.relative_to(REPO).as_posix(), "operations": notes,
        "output": final.relative_to(REPO).as_posix(), "alphaProcessing": False,
        "runtimeIntegrationActive": False}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    choice["finishedRaw"] = final.relative_to(ROOT).as_posix()
    choice["finishedMetadata"] = metadata.relative_to(ROOT).as_posix()
selection_path.write_text(json.dumps(selection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Bounded material finish complete; original gear shapes retained.")
