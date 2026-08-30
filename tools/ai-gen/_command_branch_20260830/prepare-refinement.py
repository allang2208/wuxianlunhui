"""Prepare the user-authorized refinement of the previously recommended 2/4/5."""
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PREFIX = HERE.relative_to(ROOT).as_posix()
target = HERE / "refinement-manifest.json"
if target.exists():
    raise SystemExit("Refinement manifest already exists; preserve its sources and progress.")
first = json.loads((HERE / "candidate-manifest.json").read_text(encoding="utf-8"))
second = json.loads((HERE / "candidate-manifest-b02.json").read_text(encoding="utf-8"))
manifest = {key: first[key] for key in (
    "host", "port", "model", "styleVersion", "styleTemplate", "size", "cfg", "sampler",
    "scheduler", "generationTimeout", "steps", "strength", "variants", "useEdgeControl",
    "refineSteps", "refineVariants", "refineDenoise", "refineDepthStrength", "refineEdgeStrength",
    "maskEdgePad", "modelApproval"
)}
manifest.update({
    "batchId": "f01", "stage": "refine", "refineSeedBase": 830610,
    "outputRoot": PREFIX + "/candidates_dev_s48_v1",
    "status": "refinement_prepared", "runtimeIntegrationActive": False,
    "finalSelectionByUser": False,
    "authorization": {
        "userRequest": "精修吧。同意继续精修。",
        "date": "2026-08-30",
        "selectionBasis": "Continue with the preceding recommendation: first-batch command post 2, second-batch headquarters 4 and ministry 5. These sources were restated before generation.",
        "scope": "Two 48-step candidates per selected source, same authorized Dev Depth server, material refinement only; no runtime promotion.",
        "priorStructuralReviewPassed": False,
        "knownDeviationHandling": "The user explicitly requested proceeding after the deviations were disclosed. Preserve the chosen raw layout rather than trying to move parts in refinement; historical review findings remain unchanged."
    },
    "submission": {"plannedCandidates": 6, "generatedCandidates": 0,
                   "destination": "http://192.168.3.142:8188",
                   "payload": "The three selected building raw images, their authored Depth images and refinement prompts only.",
                   "generationLog": PREFIX + "/generation-f01.log"},
    "alphaPolicy": "Raw-only generation. Authored Depth is a generation control only; it must not clip flags or other chosen raw details that differ from the model. Preview keying does not authorize final alpha or runtime integration.",
    "assets": []
})
selection = [
    (first, "command_post", 2, "b01", 2,
     "Sparse medium-scale canvas seams and timber grain, matte olive cloth, quiet fieldstone joints, naturally oxidized brass and subdued blue-grey glazing; keep the map paper low-saturation.",
     "no replacing canvas with tiles or thatch; no new roof equipment or table ornaments"),
    (second, "military_headquarters", 1, "b02", 4,
     "Quiet blue-grey slate with broad course rhythm, restrained brown-grey brickwork and stone trim, dark window frames, matte telegraph metal and aged compass brass; soften dense grains without adding ornament.",
     "no additional telegraph crossbars, attic windows, plaques or roof trim"),
    (second, "defense_ministry", 2, "b02", 5,
     "Large calm light-concrete panels, matte charcoal framing, subdued blue-grey glass reflections, a softly weathered dish, plain utility cabinet and aged compass brass; sparse medium-scale wear and muted map paper.",
     "no added roof antenna, second cabinet, second dish, brick veneer or mirror glass")
]
prompt_dir = HERE / "prepared-refinement"
prompt_dir.mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location("command_refine_pipeline", ROOT / "tools/ai-gen/generate-world122-building-candidates.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
for source_manifest, asset_id, source_variant, batch, label, details, negative in selection:
    asset = dict(next(a for a in source_manifest["assets"] if a["id"] == asset_id))
    raw = ROOT / source_manifest["outputRoot"] / asset_id / f"{asset_id}_structure_v{source_variant:02d}_raw.png"
    asset["selectedSource"] = {"raw": raw.relative_to(ROOT).as_posix(), "batchId": batch,
                               "variant": source_variant, "displayVariant": label,
                               "sourceMetadata": raw.with_name(raw.name.replace("_raw.png", "_generation.json")).relative_to(ROOT).as_posix()}
    asset["detailRequest"] = details
    asset["negativeRequest"] = negative
    asset["refineControlImage"] = asset["controlImage"]
    manifest["assets"].append(asset)
    prompt = prompt_dir / f"{asset_id}_refine_prompt.txt"
    prompt.write_text(pipeline.prompt_for(asset, manifest, "refine"), encoding="utf-8")
target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(HERE / "refinement-preview-settings.json").write_text(json.dumps({
    "purpose": "Auxiliary previews only; source and refinement raws remain untouched.",
    "default": {"threshold": 80, "removeEnclosedKey": False}, "candidates": {}
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared three selected raw sources and six standard 48-step candidates. No network requests.")
