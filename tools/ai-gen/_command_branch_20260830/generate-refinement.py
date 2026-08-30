"""Generate two refinements per selected source using the standard building CLI."""
import concurrent.futures
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
manifest_path = HERE / "refinement-manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))


def generate(asset):
    source = ROOT / asset["selectedSource"]["raw"]
    log = HERE / ("generation-f01-" + asset["id"] + ".log")
    command = [sys.executable, "-u", str(ROOT / "tools/ai-gen/generate-world122-building-candidates.py"),
               "--manifest", str(manifest_path), "--stage", "refine", "--raw-only",
               "--only", asset["id"], "--init-image", str(source)]
    print(f"Refining {asset['id']} from {source.name}; log={log.name}", flush=True)
    with log.open("wb") as handle:
        subprocess.run(command, cwd=ROOT, stdout=handle, stderr=subprocess.STDOUT, check=True)
    print(f"Completed {asset['id']}: two 48-step candidates", flush=True)


manifest["status"] = "refinement_in_progress"
manifest["submission"]["startedAt"] = datetime.now().astimezone().isoformat()
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    for future in concurrent.futures.as_completed([executor.submit(generate, asset) for asset in manifest["assets"]]):
        future.result()
manifest["submission"]["generatedCandidates"] = 6
manifest["submission"]["completedAt"] = datetime.now().astimezone().isoformat()
manifest["status"] = "refinement_candidates_awaiting_image_review"
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("All six refinement raws downloaded. Source images and game assets unchanged.", flush=True)
