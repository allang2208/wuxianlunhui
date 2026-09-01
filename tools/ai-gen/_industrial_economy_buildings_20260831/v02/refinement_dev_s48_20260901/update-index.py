"""Publish this completed candidate batch's source links, never runtime assets."""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
V02 = OUT.parent
ROOT = V02.parent
REPO = OUT.parents[4]
CORRECTIONS = V02 / "corrections_01_dev_s12"

def read(path):
    return json.loads(path.read_text(encoding="utf-8"))

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

review = read(OUT / "review.json")
manifest = read(OUT / "manifest.json")
manifest["status"] = "standard48_candidates_delivered_pending_user_selection"
manifest["authorization"].update(generationSubmitted=True, generationCompleted=True, generatedCount=4)
manifest["reviewFile"] = "review.json"
manifest["recommendedCandidates"] = review["recommendedCandidates"]
for asset in manifest["assets"]:
    asset["reviewStatus"] = "two_standard48_candidates_delivered_pending_user_selection"
    asset["recommendedCandidate"] = review["recommendedCandidates"][asset["id"]]
write(OUT / "manifest.json", manifest)

previous = read(CORRECTIONS / "correction-manifest.json")
previous["currentStatus"] = "oilC_canneryB_user_accepted_standard48_candidates_delivered"
previous["acceptedCorrectedCandidates"] = {"oil_power_plant": "C", "cannery": "B"}
previous["acceptanceUserReply"] = "可用继续"
previous["acceptanceDate"] = "2026-09-01"
previous["nextStageManifest"] = "../refinement_dev_s48_20260901/manifest.json"
for asset in previous["assets"]:
    chosen = next(a for a in manifest["assets"] if a["id"] == asset["id"])
    asset["approvedForRefinement"] = True
    asset["acceptedCorrectedCandidate"] = chosen["acceptedRefinementInput"]
    asset["reviewStatus"] = "user_accepted_corrected_candidate_standard48_candidates_delivered"
write(CORRECTIONS / "correction-manifest.json", previous)

v02 = read(V02 / "manifest.json")
v02["status"] = "oilC_canneryB_accepted_standard48_candidates_delivered"
v02["currentRefinementManifest"] = "refinement_dev_s48_20260901/manifest.json"
write(V02 / "manifest.json", v02)
root = read(ROOT / "manifest.json")
root["status"] = "oil_and_cannery_standard48_candidates_delivered_trading_company_unchanged"
root["currentRefinementManifest"] = "v02/refinement_dev_s48_20260901/manifest.json"
write(ROOT / "manifest.json", root)
model_path = CORRECTIONS / "model/oil_power_plant/model-metadata.json"
model = read(model_path)
model["userApproved"] = True
model["approvalUserReply"] = "可用继续"
model["approvalDate"] = "2026-09-01"
model["approvalContext"] = "User accepted oilC rendered from this ladder-front model for standard48"
model["status"] = "accepted_ladder_front_source_standard48_candidates_delivered"
model["refinementManifest"] = (OUT / "manifest.json").relative_to(REPO).as_posix()
write(model_path, model)
print("Updated this batch's manifest, accepted input records and model/source indexes")
