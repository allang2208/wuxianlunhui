"""Produce the user-approved six standard 48-step candidates; no cutout/runtime writes."""
import copy
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
MANIFEST = ROOT / "candidate-manifest-refine-v1.json"

def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

if not MANIFEST.exists():
    base = json.loads((ROOT / "candidate-manifest.json").read_text(encoding="utf-8"))
    manifest = copy.deepcopy(base)
    manifest["outputRoot"] = "tools/ai-gen/_engineer_branch_20260830/candidates_dev_s48_v1"
    manifest["refineSeedBase"] = 124830
    manifest["status"] = "refine_prepared"
    manifest["submission"] = {
        "plannedCandidates": 6, "generatedCandidates": 0,
        "destination": "http://192.168.3.142:8188",
        "authorization": "User explicitly selected recommended camp v2-03 / workshop 01 / factory 03 and requested continuing with 48 steps on 2026-08-30; destination authorization persists.",
        "payload": "the three selected full green raw images, their original authored Depth images and refinement prompts",
        "log": "generation-s48-v1.log"
    }
    fixes = {
        "engineer_camp": (
            "Preserve the selected full-height brown leather wall panels, continuous straw-tan thatch roof, open work bay, low rubble ground plinth and sparse gear emblem. Refine broad matte surfaces with subdued seams. The front hoist posts and crossbeam are dark worn oak, with charcoal iron hook and fittings; they are not gray metal or concrete. Keep the equipment silhouette and positions. Use a small dull naturally oxidized brass gear and reduce tiny noisy tool clutter without adding equipment.",
            "no stone wall skirt above the wood sill, metal hoist posts, concrete hoist, bright golden outlines or dense photographic straw grain"
        ),
        "engineering_workshop": (
            "Preserve the chosen continuous muted brick-red terracotta roof, gray stone hall, short chimney, open front work bay, hoist and bench. Refine broad warm-gray weathered stone, restrained tile joints, dark worn oak and naturally oxidized brass. Keep the authored shallow rectangular side-window treatment aligned to Depth, with solid wall beside the work bay rather than an extra window. Preserve the overall selected silhouette and full low ground plinth; do not add loose rocks beyond it.",
            "no sealed work bay, new side entrance, extra windows, arch ornaments, extra loose foundation rocks, bright polished brass or dense mortar noise"
        ),
        "vehicle_factory": (
            "Preserve exactly three raised glazed roof strips, the open roller-door bay, one steel service hoist, one tool bench and the complete concrete foundation. Refine quiet weathered gray concrete, charcoal steel, restrained blue-gray glazing, small worn ochre safety marks and a dull naturally oxidized gear emblem. Keep the authored shallow side-window recess at its Depth position; the wall beside the work bay remains plain without an extra utility box. Preserve the camera, roof silhouette and equipment placement.",
            "no closed roller-door bay, additional personnel entrance, extra wall utility box or rooftop equipment, bright golden outline, dense grime or photographic concrete grain"
        )
    }
    for asset in manifest["assets"]:
        variant = asset["suggestedCandidate"]
        source_root = asset.get("reviewOutputRoot", base["outputRoot"])
        asset["selectedStructureImage"] = f"{source_root}/{asset['id']}/{asset['id']}_structure_v{variant:02d}_raw.png"
        asset["selectedStructureCandidate"] = variant
        asset["selectionStatus"] = "user_selected_for_standard_refine_with_known_deviations"
        asset["detailRequest"], negative = fixes[asset["id"]]
        asset["negativeRequest"] += "; " + negative
        asset["refineControlImage"] = asset["controlImage"]
        for key in ("reviewOutputRoot", "reviewManifest", "suggestedCandidate"):
            asset.pop(key, None)
    save(MANIFEST, manifest)

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
manifest["status"] = "refine_generation_in_progress"
save(MANIFEST, manifest)
for asset in manifest["assets"]:
    print(f"Starting 48-step pair: {asset['id']}", flush=True)
    subprocess.run([
        sys.executable, str(REPO / "tools/ai-gen/generate-world122-building-candidates.py"),
        "--manifest", str(MANIFEST), "--stage", "refine", "--only", asset["id"],
        "--init-image", asset["selectedStructureImage"], "--raw-only"
    ], cwd=REPO, check=True)
    manifest["submission"]["generatedCandidates"] = sum(
        len(list((REPO / manifest["outputRoot"] / a["id"]).glob("*_refine_v??_generation.json")))
        for a in manifest["assets"]
    )
    save(MANIFEST, manifest)
manifest["status"] = "refine_candidates_complete_awaiting_user_selection"
save(MANIFEST, manifest)
print("Six standard 48-step candidates complete; no runtime integration.", flush=True)
