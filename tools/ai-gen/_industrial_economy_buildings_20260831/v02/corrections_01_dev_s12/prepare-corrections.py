"""Prepare bounded edit masks and provenance; never repaint source RGB or Alpha."""
import copy
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent
V02 = OUT.parent
REPO = OUT.parents[4]
USER = "按你建议继续，但是考虑到抠图，尽量不要把楼梯跟绿幕重叠，记住这个"
REGIONS = {
    "oil_power_plant": [
        ("chimney_and_relocated_ladder", 255, [(173, 237), (291, 237), (301, 643), (287, 734), (170, 708)]),
        ("quiet_roof", 160, [(287, 378), (477, 263), (646, 257), (823, 411), (554, 552)]),
        ("remove_upper_oil_badge", 255, [(375, 424), (411, 423), (420, 476), (382, 491)]),
        ("combined_front_badge", 255, [(650, 585), (721, 552), (735, 612), (652, 648)]),
        ("painted_fuel_tanks", 225, [(294, 635), (379, 627), (397, 660), (452, 692), (489, 685), (536, 724), (570, 760), (561, 840), (513, 866), (381, 792), (297, 751), (280, 696)]),
    ],
    "cannery": [
        ("quiet_vault_roof", 128, [(320, 426), (455, 325), (514, 314), (711, 403), (805, 474), (586, 552), (504, 616), (342, 525)]),
        ("steel_ingredient_tower", 200, [(172, 409), (299, 404), (333, 433), (330, 678), (310, 704), (205, 719), (177, 680)]),
        ("three_dimensional_tin_sign", 255, [(597, 478), (716, 446), (737, 547), (633, 602), (594, 557)]),
        ("muted_entry_hood", 160, [(582, 589), (704, 532), (738, 551), (610, 624)]),
        ("muted_left_brick_pier", 140, [(501, 599), (531, 611), (533, 746), (503, 731)]),
        ("muted_side_brick_pier", 140, [(330, 526), (356, 542), (356, 647), (332, 625)]),
        ("muted_right_brick_pier", 140, [(779, 490), (802, 480), (802, 627), (779, 637)]),
        ("unlettered_conveyor_cans", 180, [(631, 630), (650, 619), (767, 686), (757, 731), (641, 679)]),
        ("unlettered_packed_cans", 180, [(770, 619), (817, 609), (837, 669), (784, 684)]),
    ],
}
REQUESTS = {
    "oil_power_plant": (
        "Correct only the masked parts of this same two-storey fuel-oil power station. "
        "The tall cylindrical smokestack stays truly hollow with the existing dark open mouth. "
        "Move its single straight iron access ladder from the right silhouette edge to the middle of the visible chimney face, as in the updated Depth. "
        "Every ladder rung and both rails have solid chimney masonry behind them; keep the ladder top below the chimney rim, with no rail or rung against green. "
        "Erase the old right-edge ladder completely. The stack is smooth muted gray masonry, not dense speckled grit. "
        "Remove the oil-drop disc from the upper side wall, restoring matching plain wall there. "
        "Replace the round lightning disc above the front entrance with one small wide dark iron plaque containing exactly two simple raised symbols side by side: an ochre oil droplet and a dull bronze lightning bolt; no letters. "
        "Both existing horizontal tanks are matte desaturated ochre painted steel, with dark iron bands and narrow soft highlights, never gold or polished brass. "
        "Remove the tiny extra ladder on the foreground fuel tank. Roof planes retain their exact shapes but use broad smooth charcoal slate courses with very little grain. "
        "Keep the same open dark entrance, all unmasked windows, two aligned storeys, pipes, framing, camera and complete stone plinth. "
        "All green background is one perfectly flat #00FF00 field, absolutely no cast shadow of any kind, no green-screen shadow gradient. No extra object."
    ),
    "cannery": (
        "Correct only the masked parts of this same cannery. Preserve its one-storey barrel-vault factory, attached tall tin-shaped ingredient tower, horizontal silver pressure retort, open entrance, front can conveyor, crates and complete stone plinth. "
        "Replace the flat rectangular tomato poster above the front entrance with the Depth-modeled three-dimensional upright cylindrical food-tin emblem: visible elliptical silver top, rolled silver rim, rounded projecting cylindrical side, dull red paper band, one simple small tomato-and-leaf picture and no lettering. "
        "It is a physical tin-can sign mounted to the arched end wall, not a flat poster, picture frame or signboard. "
        "The large ingredient tower has subdued silver-gray steel ends and rolled rims, never gold or brass. Its food picture and label are muted oxide red with dark dusty olive leaves. "
        "Roof is quiet low-saturation gray-green sheet metal with broad smooth panels and sparse seams. "
        "Front hood and masonry piers are subdued dark terracotta; remove vivid orange and glossy red. "
        "All cans on the existing conveyor and finished-goods crate remain real closed cylindrical food cans with plain muted red bands and silver lids, absolutely no words or fake writing. "
        "Keep machinery, unmasked glazing, retort, door opening, foundations, camera and framing unchanged. "
        "No new ladders or open stair frames; any small existing supports stay entirely in front of solid building or plinth. "
        "Backdrop is uniform #00FF00 with absolutely no cast shadow of any kind, no ground shadow and no green-screen shadow gradient."
    ),
}
source_manifest = json.loads((V02 / "candidate-manifest.json").read_text(encoding="utf-8"))
manifest = copy.deepcopy(source_manifest)
manifest["outputRoot"] = OUT.relative_to(REPO).as_posix()
manifest["authorization"].update({
    "selectionUserReply": USER,
    "scope": "Two selected 01 images: bounded masked 12-step correction; oil chimney ladder relocation explicitly requested",
    "inputs": ["two original selected 01 raw images", "oil ladder-corrected full Depth", "cannery original full Depth", "local edit masks", "prompts and parameters"],
    "generationSubmitted": False, "generationCompleted": False,
    "generatedCount": 0, "refineRequested": False,
})
manifest["correctionRun"] = {
    "purpose": "User accepted recommendation to correct oil01 and cannery01; avoid green behind stairs/ladders",
    "stepsOverride": 12, "denoiseOverride": .65, "depthStrength": .75,
    "variantsPerAsset": 2, "seedBases": {"oil_power_plant": 133141, "cannery": 133151},
    "allowNonstandard": True, "rawOnly": True,
    "reason": "Bounded masked corrective experiment before standard48; not final refinement approval",
    "status": "prepared", "runtimeInstalled": False,
}
for asset in manifest["assets"]:
    asset_id = asset["id"]
    source = V02 / "candidates_dev_s12" / asset_id / f"{asset_id}_structure_v01_raw.png"
    rgb_image = Image.open(source).convert("RGB")
    rgb = np.asarray(rgb_image).astype(np.float32)
    # This selects edit regions, never the output Alpha. No source pixels are painted.
    backdrop = (rgb[..., 1] > rgb[..., 0] * 1.7) & (rgb[..., 1] > rgb[..., 2] * 1.7) & (rgb[..., 1] > 40)
    mask = Image.fromarray((backdrop * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))
    draw = ImageDraw.Draw(mask)
    for name, strength, polygon in REGIONS[asset_id]:
        draw.polygon(polygon, fill=strength)
    target = OUT / asset_id
    target.mkdir(exist_ok=True)
    mask_path = target / "source01_edit_mask.png"
    mask.save(mask_path)
    overlay = Image.new("RGB", rgb_image.size, (245, 57, 79))
    Image.composite(overlay, rgb_image, mask.point(lambda v: int(v * .38))).save(target / "source01_mask_preview.png")
    asset.update({
        "selectedStructureCandidate": source.relative_to(REPO).as_posix(),
        "selectionPurpose": "correction_reference_only", "selectionUserReply": USER,
        "maskedRefineRequest": REQUESTS[asset_id],
        "detailRequest": REQUESTS[asset_id],
        "reviewStatus": "selected_01_masked_correction_prepared", "approvedForRefinement": False,
        "maskImage": mask_path.relative_to(REPO).as_posix(),
        "maskRegions": REGIONS[asset_id],
        "sceneBackdropRequest": "Flat uniform chroma green #00FF00 immediately outside the full foundation; absolutely no cast shadow of any kind, ground shadow or green-screen shadow gradient.",
    })
    if asset_id == "oil_power_plant":
        model_dir = OUT / "model" / asset_id
        asset["controlImage"] = (model_dir / f"{asset_id}_body_depth.png").relative_to(REPO).as_posix()
        asset["postprocessDepthImage"] = asset["controlImage"]
        asset["modelSource"] = (model_dir / f"{asset_id}_model.blend").relative_to(REPO).as_posix()
        asset["modelApproval"] = "Original v02 approved; user explicitly requested this narrow ladder correction while continuing selected01 correction. Hall, mouth and foundation unchanged."
        # Normalize provenance from the initial render's path-root typo without rerendering pixels.
        meta_path = model_dir / "model-metadata.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["priorModel"] = (V02 / asset_id / f"{asset_id}_model.blend").relative_to(REPO).as_posix()
        meta["builder"] = (OUT / "adjust-oil-model.py").relative_to(REPO).as_posix()
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(OUT / "correction-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared 2 masks and correction manifest; source raw images unchanged")
