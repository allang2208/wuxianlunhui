"""Recover only the previously submitted engineer-camp job; never submit or cancel jobs."""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = "http://192.168.3.142:8188"
DEST = ROOT / "candidates_dev_s12_v1/engineer_camp/engineer_camp_structure_v01_raw.png"
DEPTH_NAME = "engineer_camp_structure_depth.png"

def get(route):
    with urllib.request.urlopen(BASE + route, timeout=60) as response:
        return json.load(response)

def matches(workflow):
    nodes = list(workflow.values())
    depth = any(DEPTH_NAME in str(node.get("inputs", {}).get("image", "")) for node in nodes)
    seed = any(node.get("inputs", {}).get("seed", node.get("inputs", {}).get("noise_seed")) == 122831 for node in nodes)
    return depth and seed

def save_result(job_id, entry):
    if entry.get("status", {}).get("status_str") == "error":
        print(json.dumps({"status": "previous_job_error", "jobId": job_id, "detail": entry.get("status")}, ensure_ascii=False), flush=True)
        return True
    if not entry.get("status", {}).get("completed"):
        return False
    images = [image for output in entry.get("outputs", {}).values() for image in output.get("images", []) if image.get("type") == "output"]
    if not images:
        return False
    source = images[0]
    query = urllib.parse.urlencode({key: source.get(key, "") for key in ("filename", "subfolder", "type")})
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(BASE + "/view?" + query, timeout=60) as response:
        DEST.write_bytes(response.read())
    record = {"status": "recovered", "jobId": job_id, "image": source, "destination": str(DEST), "host": BASE}
    (ROOT / "recovered-first-job.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(record, ensure_ascii=False), flush=True)
    return True

history = get("/history?max_items=100")
found = [(job_id, entry) for job_id, entry in history.items() if len(entry.get("prompt", [])) > 2 and matches(entry["prompt"][2])]
for job_id, entry in reversed(found):
    if save_result(job_id, entry):
        raise SystemExit(0)
queue = get("/queue")
queued = [row for name in ("queue_running", "queue_pending") for row in queue.get(name, []) if len(row) > 2 and matches(row[2])]
if not queued:
    print(json.dumps({"status": "no_matching_history_or_queue", "historyLimit": 100}), flush=True)
    raise SystemExit(0)
job_id = queued[0][1]
print(json.dumps({"status": "waiting_for_existing_job", "jobId": job_id}), flush=True)
deadline = time.monotonic() + 1800
while time.monotonic() < deadline:
    entry = get("/history/" + urllib.parse.quote(job_id, safe="")).get(job_id)
    if entry and save_result(job_id, entry):
        break
    time.sleep(5)
else:
    raise TimeoutError("Existing matching job has not finished; do not resubmit it.")
