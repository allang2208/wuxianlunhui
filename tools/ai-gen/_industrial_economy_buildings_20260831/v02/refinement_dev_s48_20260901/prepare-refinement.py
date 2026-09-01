"""Prepare standard48 from the user-accepted oilC and canneryB, without geometry edits."""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
V02 = OUT.parent
REPO = OUT.parents[4]
CORRECTIONS = V02 / "corrections_01_dev_s12"
USER = "可用继续"
source_manifest = json.loads((CORRECTIONS / "correction-manifest.json").read_text(encoding="utf-8"))
settings = ("host", "port", "model", "styleVersion", "styleTemplate", "size", "cfg", "sampler", "scheduler", "generationTimeout")
manifest = {key: source_manifest[key] for key in settings}
manifest.update({
    "outputRoot": OUT.relative_to(REPO).as_posix(),
    "structureSteps": 12, "structureVariants": 3, "structureDepthStrength": .78,
    "refineSteps": 48, "refineVariants": 2, "refineDenoise": .30,
    "refineDepthStrength": .75, "refineSeedBase": 133200, "useEdgeControl": False,
    "status": "prepared_standard48",
    "authorization": {
        "userReply": USER, "date": "2026-09-01",
        "acceptedCandidates": {"oil_power_plant": "C", "cannery": "B"},
        "scope": "User accepted the displayed corrected oilC and canneryB and requested continuation; proceed to standard48, two candidates per building",
        "priorReviewResolution": "Latest user acceptance supersedes recommendation-only status; preserve earlier material/label/shadow observations as refinement notes, not a new approval blocker",
        "destination": "http://192.168.3.142:8188", "destinationUploadAuthorized": True,
        "standingAuthorizationRecord": "AGENTS.md#建筑管线局域网上传授权（2026-08-31）",
        "inputs": ["accepted oilC and canneryB complete raw images", "same authored full Depth images", "prompts and standard48 parameters"],
        "refinementRequested": True, "generationSubmitted": False,
        "generationCompleted": False, "generatedCount": 0,
        "runtimeInstallationRequested": False,
    },
    "assets": [],
})
inputs = {
    "oil_power_plant": CORRECTIONS / "ladder_fix/oil_power_plant/oil_power_plant_refine_v01_raw.png",
    "cannery": CORRECTIONS / "cannery/cannery_refine_v02_raw.png",
}
requests = {
    "oil_power_plant": (
        "two-storey oil-fired power station matching the accepted image C exactly. "
        "Preserve both aligned floors, continuous pitched roof, all windows, dark open entrance, "
        "oil-drop and lightning plaque, two horizontal fuel tanks, connected flue and full stone foundation. "
        "The single tall chimney stays visibly open and hollow. Its one straight iron ladder stays centered on "
        "the visible front chimney wall, with SOLID GRAY MASONRY behind every rung; ladder top remains below "
        "the chimney rim. Do not move it to either silhouette edge or add hooks above the rim. "
        "Refine existing surfaces only: broad calm gray masonry, smooth dark blue-gray slate roof courses, "
        "muted ochre painted steel fuel tanks with restrained soft highlights, blackened iron bands and "
        "a small matte aged-bronze emblem. Reduce fine speckle, harsh gold shine and repetitive microtexture "
        "without changing shapes or color families. Blend the faint old upper-wall badge scar into adjacent masonry. "
        "Maintain the exact camera, crop, four foundation corners and equipment positions. "
        "The background outside the complete foundation is flat uniform chroma green #00FF00, "
        "with absolutely no cast shadow of any kind, no ground shadow and no green-screen shadow gradient."
    ),
    "cannery": (
        "canning factory matching the accepted image B exactly. Preserve the single-storey barrel-vault hall, "
        "tall cylindrical ingredient tank with tomato label, horizontal pressure retort and pipes, large glazing, "
        "dark open entrance, attached conveyor, sealing equipment, food cans, two crates and complete stone foundation. "
        "The front facade emblem remains one real projecting CYLINDRICAL FOOD CAN with a visible elliptical "
        "silver top, rolled rim and rounded side; keep its current position and size, never flatten it into a poster. "
        "Refine existing broad material fields only: subdued gray-green metal roof, warm-gray plaster, "
        "muted terracotta framing, silver-gray steel retort and tank rims, quiet red food-label bands and "
        "small dusty olive leaves. Keep sparse medium-scale wear and reduce fine grain, gold shine and "
        "bright orange highlights. Food-can labels use a simple tomato picture or a plain band, "
        "without letters, numbers, fake words or tiny writing. Do not replace conveyor cans with loose vegetables. "
        "Keep camera, silhouettes, openings, supports and full plinth unchanged; add no skylights, "
        "extra machinery, ladders or stairs. Any existing thin supports remain in front of solid building or plinth. "
        "Every background region is flat uniform #00FF00 with absolutely no cast shadow of any kind, "
        "ground shadow, backdrop shadow or green-screen shadow gradient."
    ),
}
asset_keys = ("id", "label", "assetClass", "assetType", "foundationStyle", "footprintCells", "controlImage", "postprocessDepthImage", "primaryRequest", "paletteConstraint", "negativeRequest", "modelSource")
for old in source_manifest["assets"]:
    asset = {key: old[key] for key in asset_keys if key in old}
    asset_id = asset["id"]
    source = inputs[asset_id].relative_to(REPO).as_posix()
    asset.update({
        "detailRequest": requests[asset_id],
        "selectedStructureCandidate": source, "acceptedRefinementInput": source,
        "acceptedCandidateLabel": "C" if asset_id == "oil_power_plant" else "B",
        "selectionUserReply": USER, "selectionDate": "2026-09-01",
        "selectionPurpose": "standard48_refinement_input", "approvedForRefinement": True,
        "finalArtApproved": False, "runtimeInstalled": False,
        "reviewStatus": "user_accepted_corrected_input_standard48_prepared",
        "modelApproval": "User accepted these corrected images; reuse their exact authored model and full Depth without geometry changes",
        "sceneBackdropRequest": "Perfectly uniform chroma green #00FF00 outside the full foundation; absolutely no cast shadow of any kind, ground shadow, backdrop shadow or green-screen shadow gradient.",
    })
    asset["negativeRequest"] += "; no added letters, numbers, pseudo-text, fine granular noise, saturated gold trim or changes to approved openings and machinery"
    manifest["assets"].append(asset)
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

review_path = CORRECTIONS / "review.json"
review = json.loads(review_path.read_text(encoding="utf-8"))
review.update({
    "status": "user_accepted_oilC_canneryB_for_standard48",
    "approvedForRefinement": True,
    "userSelectedCorrectedCandidates": {"oil_power_plant": "C", "cannery": "B"},
    "acceptanceUserReply": USER, "acceptanceDate": "2026-09-01",
    "acceptanceNote": "User accepted the displayed C/B after reviewing the disclosed remaining issues; earlier visual findings are retained as history",
    "nextStageManifest": "../refinement_dev_s48_20260901/manifest.json",
})
for asset_id, candidates in review["assets"].items():
    for item in candidates:
        if item["label"] == ("C" if asset_id == "oil_power_plant" else "B"):
            item["userApprovedForRefinement"] = True
            item["acceptanceUserReply"] = USER
review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared standard48 manifest from accepted oilC and canneryB; earlier sources preserved")
