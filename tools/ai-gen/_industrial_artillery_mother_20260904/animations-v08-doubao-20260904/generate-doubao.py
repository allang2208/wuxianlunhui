#!/usr/bin/env python3
"""Generate one prepared Doubao action with mandatory fill-only preflight."""

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
ACTIONS = ("idle", "running", "attacking", "dying")


def now() -> str:
    return datetime.now().astimezone().isoformat()


def save(data: dict) -> None:
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(command: list[object]) -> None:
    subprocess.run([str(part) for part in command], cwd=WORKSPACE, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=ACTIONS, required=True)
    args = parser.parse_args()
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    job = data["actions"][args.only]
    video = ROOT / job["video"]
    if video.exists() or job["status"] != "prepared":
        raise RuntimeError(f"Refusing overwrite or retry: {args.only} ({job['status']})")
    reference = (ROOT / data["reference"]).resolve()
    prompt = (ROOT / job["prompt"]).resolve()
    common = [
        "--attach-only", "--cdp-port", "9333", "--ref", reference,
        "--prompt-file", prompt, "--out", video, "--duration", "5",
        "--size", "1024x576", "--model", data["requestedModel"],
    ]
    if job["loop"]:
        common.append("--loop")
    job["status"] = "preparing_prompt_fill_only"
    job["startedAt"] = now()
    data["status"] = "generating"
    save(data)
    try:
        run(["node", DOUBAO, *common, "--new-chat", "--fill-only"])
        job["status"] = "generation_command_started_do_not_resubmit"
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
            command += ["--motion-mode", job["motionMode"]]
        run(command)
        run([PYTHON, ROOT / "build-video-previews.py", args.only])
        job.update({
            "status": "source_candidate_ready_pending_visual_review",
            "downloadedAt": now(),
            "provenance": job["video"] + ".json",
            "gif": f"previews/{video.stem}.gif",
            "contact": f"previews/{video.stem}-contact.png",
        })
        data["status"] = "partially_generated_pending_source_review"
        save(data)
    except Exception as exc:
        job["lastError"] = str(exc)
        job["stoppedAt"] = now()
        data["status"] = "stopped_requires_inspection_no_automatic_resubmit"
        save(data)
        raise


if __name__ == "__main__":
    main()
