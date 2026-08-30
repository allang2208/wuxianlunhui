"""Prepare reviewable candidate prompts locally; never contact the render server."""
import argparse
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
source = ROOT / "tools/ai-gen/generate-world122-building-candidates.py"
spec = importlib.util.spec_from_file_location("command_candidate_pipeline", source)
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
parser = argparse.ArgumentParser()
parser.add_argument("--manifest", type=Path, default=HERE / "candidate-manifest.json")
args = parser.parse_args()
manifest_path = args.manifest.resolve()
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
prepared = ROOT / manifest.get("preparedInputsRoot", HERE / "prepared-inputs")
prepared.mkdir(exist_ok=True)
inputs = []
for index, asset in enumerate(manifest["assets"]):
    prompt_path = prepared / (asset["id"] + "_structure_prompt.txt")
    prompt_path.write_text(pipeline.prompt_for(asset, manifest, "structure"), encoding="utf-8")
    inputs.append({
        "assetId": asset["id"], "label": asset["label"],
        "depth": asset["controlImage"],
        "prompt": prompt_path.relative_to(ROOT).as_posix(),
        "plannedSeeds": [manifest["structureSeedBase"] + index * 10 + n for n in range(1, 4)]
    })
# Input preparation must not erase a later authorization or generation result.
manifest["submission"]["preparedInputs"] = inputs
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared three prompts and nine planned seeds locally. No network requests made.")
