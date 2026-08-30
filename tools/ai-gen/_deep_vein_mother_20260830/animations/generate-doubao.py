"""Generate the approved seven-action Doubao source batch; never retry submissions."""
import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[3]
PYTHON = WORKSPACE.parent / "ComfyUI/.venv/Scripts/python.exe"
ENTRY = WORKSPACE / "tools/ai-gen/ai-asset.py"
DOUBAO = WORKSPACE / "tools/ai-gen/doubao-seedance-gen.mjs"
MANIFEST = ROOT / "task-index.json"

def now():
    return datetime.now().astimezone().isoformat()

def save(data):
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def run(command):
    subprocess.run([str(part) for part in command], cwd=WORKSPACE, check=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int, default=6)
    args = parser.parse_args()
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for index in range(args.start, args.end + 1):
        job = data["jobs"][index]
        video = ROOT / job["video"]
        if video.exists() or job["status"] != "prepared":
            raise RuntimeError(f"Refusing overwrite or automatic retry: {job['state']} ({job['status']})")
        reference = (ROOT / job["mother"]).resolve()
        prompt = (ROOT / job["promptFile"]).resolve()
        common = ["--attach-only", "--cdp-port", "9333", "--ref", reference,
                  "--prompt-file", prompt, "--out", video, "--duration", job["duration"],
                  "--size", data["size"], "--model", data["model"]]
        if job["loop"]:
            common += ["--loop"]
        job["status"] = "preparing-prompt"
        job["startedAt"] = now()
        data["status"] = "generating"
        save(data)
        print(f"PREPARING {index + 1}/7 {job['state']}", flush=True)
        try:
            run(["node", DOUBAO, *common, "--new-chat", "--fill-only"])
            job["status"] = "generation-command-started-do-not-resubmit"
            save(data)
            command = [PYTHON, ENTRY, "video", "generate", "--provider", "doubao",
                       "--doubao-attach-only", "--ref", reference, "--prompt", prompt,
                       "--out", video, "--duration", job["duration"], "--size", data["size"],
                       "--candidates", "1", "--timeout", "1200"]
            if job["loop"]:
                command += ["--loop"]
            else:
                command += ["--motion-mode", "one-way" if job["state"] == "dying" else "recover"]
            run(command)
            job["status"] = "downloaded-preview-pending"
            job["downloadedAt"] = now()
            save(data)
            run([PYTHON, ROOT / "build-video-previews.py", "--video", video])
            job["status"] = "source-candidate-awaiting-user-review"
            job["gif"] = f"previews/{video.stem}-source.gif"
            job["contact"] = f"previews/{video.stem}-contact.png"
            job["provenance"] = job["video"] + ".json"
            job["approved"] = False
            save(data)
            print(f"COMPLETE {index + 1}/7 {job['state']}", flush=True)
        except Exception as exc:
            job["lastError"] = str(exc)
            job["stoppedAt"] = now()
            data["status"] = "stopped-requires-inspection-no-automatic-resubmit"
            save(data)
            raise
    data["status"] = "seven-source-candidates-awaiting-user-review" if all(
        j["status"] == "source-candidate-awaiting-user-review" for j in data["jobs"]
    ) else "partially-generated"
    save(data)

if __name__ == "__main__":
    main()
