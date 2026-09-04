"""Single-purpose masked removal trials after the combined window/material pass."""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = ROOT / "local_repair_v2_removal"
selection_path = ROOT / "local-review-selection.json"
selection = json.loads(selection_path.read_text(encoding="utf-8"))
base = json.loads((ROOT / "candidate-manifest-local-v1.json").read_text(encoding="utf-8"))
parser = argparse.ArgumentParser()
parser.add_argument("asset", choices=("engineering_workshop", "vehicle_factory"))
parser.add_argument("--weak-depth", action="store_true", help="local retry when old Depth depicts the unwanted protrusion")
args = parser.parse_args()
if args.weak_depth:
    OUT = ROOT / "local_repair_v3_removal"
asset = copy.deepcopy(next(a for a in base["assets"] if a["id"] == args.asset))
choice = selection[asset["id"]]
OUT.mkdir(exist_ok=True)
source = ROOT / "local_repair_v1" / asset["id"] / f"{asset['id']}_refine_v{choice['candidate']:02d}_local_raw.png"
mask = Image.new("L", (1024,1024), 0)
if asset["id"] == "engineering_workshop":
    polygon = [(669,499),(732,479),(738,491),(738,565),(699,584),(699,608),(669,625)]
    request = "The entire masked patch is uninterrupted solid gray STONE MASONRY WALL. Erase the arched window, all glass, the entire timber frame, sill, lintel and shadow. Replace them with ordinary gray stone blocks and matching mortar continuing seamlessly from the neighboring wall, with identical stone size, color, perspective and lighting. This is a blank stone wall repair patch, not an opening. Absolutely no window, door, niche, panel, frame, ornament, glowing area or sign anywhere inside this mask. Everything outside the mask including the open main door and foreground tool rack remains exactly unchanged."
else:
    polygon = [(692,573),(752,548),(761,559),(761,622),(691,646)]
    request = "The entire masked patch is uninterrupted flat gray CONCRETE WALL. Erase the electrical utility box, control panel, all borders, bolts, shadow and markings. Fill the masked region with plain continuous matte gray concrete of the same value, perspective and sparse weathering as the neighboring wall. Absolutely no box, panel, window, niche, door, sign, frame, display or protrusion inside the mask. Everything outside the mask remains exactly unchanged."
ImageDraw.Draw(mask).polygon(polygon, fill=255)
mask = ImageChops.multiply(mask, mask.filter(ImageFilter.GaussianBlur(2)))
mask_path = OUT / f"{asset['id']}_removal_mask.png"
mask.convert("RGB").save(mask_path)
asset["maskedRefineRequest"] = request
asset["detailRequest"] = request
asset["negativeRequest"] = "Inside the mask: no window, frame, arch, inset panel, electrical box, illumination or ornaments. Outside the mask: no changes."
asset["maskImage"] = mask_path.relative_to(REPO).as_posix()
asset["selectedRefineImage"] = source.relative_to(REPO).as_posix()
manifest = copy.deepcopy(base)
manifest["assets"] = [asset]
manifest["outputRoot"] = OUT.relative_to(REPO).as_posix()
manifest["refineSeedBase"] = 126840 if asset["id"] == "engineering_workshop" else 126850
if args.weak_depth:
    manifest["refineSeedBase"] = 127850
    manifest["refineDepthStrength"] = .15
    manifest["localControlException"] = "The inspected original Depth contains the old modeled tool-rack backboard at the unwanted wall-panel location. Retain that original full Depth as provenance but reduce its influence to 0.15 only for this masked removal trial; unmasked source pixels remain exact in the local composite."
manifest["experiment"] = "One candidate for a bounded single-purpose removal trial; no full-building redraw. Original standard 48-step source and previous masked variants retained."
manifest["submission"] = {"plannedCandidates": 1, "generatedCandidates": 0, "destination": "http://192.168.3.142:8188", "authorization": base["submission"]["authorization"]}
manifest["status"] = "local_removal_in_progress"
manifest_path = OUT / f"{asset['id']}_removal_manifest.json"
def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
save(manifest_path, manifest)
subprocess.run([
    sys.executable, str(REPO / "tools/ai-gen/generate-world122-building-candidates.py"),
    "--manifest", str(manifest_path), "--stage", "refine", "--only", asset["id"],
    "--init-image", str(source), "--mask-image", str(mask_path), "--mask-channel", "red",
    "--denoise", "0.90", "--allow-nonstandard", "--variants", "1", "--raw-only"
], cwd=REPO, check=True)
stem = f"{asset['id']}_refine_v01"
generated = OUT / asset["id"] / (stem + "_raw.png")
composite = generated.with_name(stem + "_local_raw.png")
Image.composite(Image.open(generated).convert("RGB"), Image.open(source).convert("RGB"), mask).save(composite)
metadata = generated.with_name(stem + "_local_metadata.json")
save(metadata, {"input": source.relative_to(REPO).as_posix(),
    "generation": generated.relative_to(REPO).as_posix(), "mask": mask_path.relative_to(REPO).as_posix(),
    "maskPolygon": polygon, "maskFeatherPixels": 2,
    "operation": "composite only masked pixels over previous accepted local candidate; no alpha processing",
    "output": composite.relative_to(REPO).as_posix()})
manifest["status"] = "local_removal_complete_pending_visual_review"
manifest["submission"]["generatedCandidates"] = 1
save(manifest_path, manifest)
print(composite)
