"""Create the user-requested second batch without modifying the first batch."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PREFIX = HERE.relative_to(ROOT).as_posix()
target = HERE / "candidate-manifest-b02.json"
if target.exists():
    raise SystemExit("Batch 02 already exists; preserve its prompts and lifecycle.")
manifest = json.loads((HERE / "candidate-manifest.json").read_text(encoding="utf-8"))
for key in ("reviewIndex", "reviewNotes", "structuralReviewPassed"):
    manifest.pop(key, None)
manifest.update({
    "batchId": "b02", "variantLabelOffset": 3,
    "outputRoot": PREFIX + "/candidates_dev_s12_v2",
    "structureSeedBase": 830510,
    "preparedInputsRoot": PREFIX + "/prepared-inputs-b02",
    "reviewOutputRoot": PREFIX + "/candidate-review-b02",
    "reviewSettings": PREFIX + "/preview-settings-b02.json",
    "reviewNotes": PREFIX + "/candidate-review-notes-b02.json",
    "reviewTitle": "指挥建筑 / 第二批候选",
    "status": "structure_generation_prepared",
    "structuralReviewPassed": None,
    "selectedByUser": False, "refinementStarted": False,
    "submission": {
        "plannedCandidates": 9, "generatedCandidates": 0,
        "destination": "http://192.168.3.142:8188",
        "payload": "The same three approved building Depth images and revised building prompts only.",
        "authorization": "2026-08-30: User requested 继续抽 after the first nine-candidate delivery, continuing the already authorized server and Dev Depth workflow.",
        "generationLog": PREFIX + "/generation-b02.log"
    },
    "revision": {
        "previousBatch": PREFIX + "/candidate-manifest.json",
        "geometryChanged": False, "standardParametersChanged": False,
        "scope": "New seeds and concise asset-level descriptions clarify the near-corner pennant, simple telegraph crossbar, bare planning table and fixed equipment counts. No model, camera, footprint or runtime changes."
    }
})
requests = {
    "command_post": (
        "Single-storey timber command hall with olive canvas wall panels and one hipped canvas roof. Preserve the attached canvas porch, open timber doors and one small oxidized-brass compass plaque. The single short dark-teal pennant stands at the near corner where the two visible walls meet, immediately left of the porch. The right-hand low table holds only a muted paper map and low markers.",
        "no flag at the far left image edge or rear corner; no thatch, brick main walls, tiled roof, rooftop equipment, table-mounted device or statue"
    ),
    "military_headquarters": (
        "Two-storey brown-grey brick headquarters, grey stone quoins and floor band, one hipped blue-grey slate roof. One short T-shaped telegraph pole on the roof, with exactly one horizontal crossbar. Preserve the flat stone entrance canopy, open timber doors and one small oxidized-brass compass plaque. One short plain dark-teal pennant stands at the near wall corner immediately left of the canopy; the low table on the right holds only a muted paper map.",
        "no flag at the far left image edge or rear corner; no multiple antenna crossbars, TV antenna, pitched entrance canopy, chimney, dish or table-mounted device"
    ),
    "defense_ministry": (
        "One three-storey central command block and two attached two-storey wings, flat parapet roofs, light concrete, charcoal steel and muted blue-grey windows. Preserve the concrete entrance canopy and two small oxidized-brass compass plaques. Equipment consists of one plain rectangular service cabinet on the highest roof and one dish on the left wing, without additional rooftop fittings. One short plain dark-teal pennant stands at the near wall corner left of the entrance; the right-hand low table holds only a muted paper map.",
        "no flag at the far left image edge or rear corner; no flag emblem, roof antenna, cable clutter, second service cabinet, brick veneer or pitched roof"
    )
}
for asset in manifest["assets"]:
    asset["structureRequest"], asset["negativeRequest"] = requests[asset["id"]]
target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(HERE / "preview-settings-b02.json").write_text(json.dumps({
    "purpose": "Batch 02 auxiliary previews only; inspect each complete raw before choosing preview key settings.",
    "default": {"threshold": 80, "removeEnclosedKey": False}, "candidates": {}
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared batch 02 with seeds 830511-513, 830521-523, 830531-533. No network request.")
