"""Record completed image-production provenance without touching runtime assets."""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
V02 = OUT.parent
ROOT = V02.parent
USER = "按你建议继续，但是考虑到抠图，尽量不要把楼梯跟绿幕重叠，记住这个"

def load(path):
    return json.loads(path.read_text(encoding="utf-8"))

def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

review = load(OUT / "review.json")
manifest = load(OUT / "correction-manifest.json")
manifest["authorization"].update(generationSubmitted=True, generationCompleted=True, generatedCount=4)
manifest["correctionRun"]["status"] = "completed_reviewed"
manifest["correctionRun"]["reviewFile"] = "review.json"
manifest["additionalCorrections"] = review.get("additionalCorrections", [])
manifest["totalCorrectedRawCount"] = review["outputCount"]
manifest["recommendedCandidates"] = review["recommendedCandidates"]
for asset in manifest["assets"]:
    asset["reviewStatus"] = "corrected_candidates_delivered_pending_user_selection"
save(OUT / "correction-manifest.json", manifest)
for folder in ("ladder_fix",):
    path = OUT / folder / "manifest.json"
    if path.exists():
        item = load(path)
        item["authorization"].update(generationSubmitted=True, generationCompleted=True, generatedCount=1)
        item["correctionRun"]["status"] = "completed_reviewed"
        save(path, item)

old_review_path = V02 / "candidates_dev_s12/review.json"
old = load(old_review_path)
old.update(status="original01_selected_for_correction", userSelectedCandidates={"oil_power_plant": 1, "cannery": 1},
           selectionUserReply=USER, selectionPurpose="correction_reference_only",
           nextStage="../corrections_01_dev_s12/review.json")
save(old_review_path, old)
base = load(V02 / "candidate-manifest.json")
for asset in base["assets"]:
    asset.update(selectionUserReply=USER, selectedStructureCandidate=asset["recommendedCorrectionCandidate"],
                 selectionPurpose="correction_reference_only", reviewStatus="original01_selected_for_correction",
                 correctionManifest="corrections_01_dev_s12/correction-manifest.json", approvedForRefinement=False)
save(V02 / "candidate-manifest.json", base)
v02 = load(V02 / "manifest.json")
v02["status"] = "original01_selected_corrective_candidates_delivered"
v02["currentCorrectionManifest"] = "corrections_01_dev_s12/correction-manifest.json"
v02["ladderModelRevision"] = "corrections_01_dev_s12/model/oil_power_plant/oil_power_plant_model.blend"
save(V02 / "manifest.json", v02)
root = load(ROOT / "manifest.json")
root["status"] = "oil_and_cannery_01_corrective_candidates_delivered_trading_company_unchanged"
root["scope"] = "Editable models and pre-final corrective image candidates; no runtime integration"
root["activeModelRevisions"]["oil_power_plant"] = "v02-ladder-front"
root["revisionNote"] = "Original geometry below is a retained ancestor; cannery uses v02; oil uses the v02 ladder-front correction recorded in currentOilModelCorrection"
root["currentCorrectionManifest"] = "v02/corrections_01_dev_s12/correction-manifest.json"
root["currentOilModelCorrection"] = "v02/corrections_01_dev_s12/model/oil_power_plant/oil_power_plant_model.blend"
save(ROOT / "manifest.json", root)
model_path = OUT / "model/oil_power_plant/model-metadata.json"
model = load(model_path)
model["aiGenerationStarted"] = True
model["inheritedModelApprovalUserReply"] = model.pop("approvalUserReply", "可用，进行12步生图")
model["finalArtApproved"] = False
save(model_path, model)
print("Updated only this building batch's provenance and selection indexes")
