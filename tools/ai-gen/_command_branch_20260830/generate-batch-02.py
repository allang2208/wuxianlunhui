"""Submit the requested second batch through the standard building generator."""
import concurrent.futures
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
manifest_path = HERE / "candidate-manifest-b02.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))


def generate(asset):
    log = HERE / ("generation-b02-" + asset["id"] + ".log")
    command = [sys.executable, "-u", str(ROOT / "tools/ai-gen/generate-world122-building-candidates.py"),
               "--manifest", str(manifest_path), "--stage", "structure", "--raw-only", "--only", asset["id"]]
    print(f"Generating batch 02 {asset['id']}; log={log.name}", flush=True)
    with log.open("wb") as handle:
        subprocess.run(command, cwd=ROOT, stdout=handle, stderr=subprocess.STDOUT, check=True)
    print(f"Completed batch 02 {asset['id']}: three raw candidates", flush=True)


manifest["status"] = "structure_generation_in_progress"
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    for result in concurrent.futures.as_completed([executor.submit(generate, asset) for asset in manifest["assets"]]):
        result.result()
manifest["submission"]["generatedCandidates"] = 9
manifest["status"] = "structure_candidates_awaiting_image_review"
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("All nine batch 02 raw candidates downloaded. No runtime asset writes.", flush=True)
