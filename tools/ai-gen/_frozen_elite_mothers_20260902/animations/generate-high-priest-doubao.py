"""Generate the four approved High Priest Doubao clips once, with fill-only preflight."""
from __future__ import annotations

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
MANIFEST = ROOT / "manifest.json"
UNIT = "polarNightHighPriest"


def now() -> str:
    return datetime.now().astimezone().isoformat()


def save(data: dict) -> None:
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(command: list[object]) -> None:
    subprocess.run([str(part) for part in command], cwd=WORKSPACE, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=("idle", "running", "attacking", "dying"), required=True)
    args = parser.parse_args()
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    unit = data["units"][UNIT]
    job = unit["actions"][args.only]
    video = ROOT / job["video"]
    if video.exists() or job["status"] != "prepared":
        raise RuntimeError(f"Refusing overwrite or retry: {args.only} ({job['status']})")
    reference = (ROOT / job["reference"]).resolve()
    prompt = (ROOT / job["prompt"]).resolve()
    common = [
        "--attach-only", "--cdp-port", "9333", "--ref", reference,
        "--prompt-file", prompt, "--out", video, "--duration", "5",
        "--size", "1024x576", "--model", "Seedance 2.0 Mini",
    ]
    if job["loop"]:
        common.append("--loop")
    video.parent.mkdir(parents=True, exist_ok=True)
    job["status"] = "preparing-prompt"
    job["startedAt"] = now()
    unit["status"] = "generating"
    data["status"] = "generating_high_priest"
    save(data)
    try:
        run(["node", DOUBAO, *common, "--new-chat", "--fill-only"])
        job["status"] = "generation-command-started-do-not-resubmit"
        save(data)
        command = [
            PYTHON, ENTRY, "video", "generate", "--provider", "doubao",
            "--doubao-attach-only", "--ref", reference, "--prompt", prompt,
            "--out", video, "--duration", "5", "--size", "1024x576",
            "--candidates", "1", "--timeout", "1800",
        ]
        if job["loop"]:
            command.append("--loop")
        else:
            command += ["--motion-mode", "one-way" if args.only == "dying" else "recover"]
        run(command)
        run([PYTHON, ROOT / "build-video-previews.py", args.only])
        job.update({
            "status": "source-candidate-ready",
            "downloadedAt": now(),
            "provenance": job["video"] + ".json",
            "gif": f"previews/polar-night-high-priest/{video.stem}-preview.gif",
            "contact": f"previews/polar-night-high-priest/{video.stem}-contact.png",
        })
        unit["status"] = "partially_generated_pending_offline_review"
        data["status"] = "partial_high_priest_generation"
        save(data)
    except Exception as exc:
        job["lastError"] = str(exc)
        job["stoppedAt"] = now()
        unit["status"] = "stopped_requires_inspection_no_automatic_resubmit"
        data["status"] = "stopped_requires_inspection_no_automatic_resubmit"
        save(data)
        raise


if __name__ == "__main__":
    main()
