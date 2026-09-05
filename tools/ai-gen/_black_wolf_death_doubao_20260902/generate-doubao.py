"""Generate the black-wolf death clip once, with a fill-only preflight."""
from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]
PYTHON = WORKSPACE.parent / "ComfyUI/.venv/Scripts/python.exe"
ENTRY = WORKSPACE / "tools/ai-gen/ai-asset.py"
DOUBAO = WORKSPACE / "tools/ai-gen/doubao-seedance-gen.mjs"
MANIFEST = ROOT / "manifest.json"


def now() -> str:
    return datetime.now().astimezone().isoformat()


def save(data: dict) -> None:
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(command: list[object]) -> None:
    subprocess.run([str(part) for part in command], cwd=WORKSPACE, check=True)


def main() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    video = ROOT / data["video"]
    if video.exists() or data["status"] != "prepared":
        raise RuntimeError(f"Refusing overwrite or retry: {data['status']}")
    reference = (ROOT / data["reference"]).resolve()
    prompt = (ROOT / data["prompt"]).resolve()
    common = [
        "--cdp-port", "9333", "--ref", reference, "--prompt-file", prompt,
        "--out", video, "--duration", "5", "--size", "1024x576",
        "--model", "Seedance 2.0 Mini", "--new-chat",
    ]
    data["status"] = "preparing-prompt"
    data["startedAt"] = now()
    save(data)
    try:
        # This launches the isolated automated client when no prior CDP session exists.
        run(["node", DOUBAO, *common, "--fill-only"])
        data["status"] = "generation-command-started-do-not-resubmit"
        save(data)
        run([
            PYTHON, ENTRY, "video", "generate", "--provider", "doubao",
            "--doubao-attach-only", "--ref", reference, "--prompt", prompt,
            "--out", video, "--duration", "5", "--size", "1024x576",
            "--candidates", "1", "--timeout", "1800", "--motion-mode", "one-way",
        ])
        run([PYTHON, ROOT / "build-video-preview.py"])
        data.update({
            "status": "source-candidate-ready",
            "downloadedAt": now(),
            "provenance": data["video"] + ".json",
            "gif": "previews/black-wolf-dying-doubao-v01.gif",
            "contact": "previews/black-wolf-dying-doubao-v01-contact.png",
            "validationBoundary": "source video downloaded and whole-source previews built; formal frame window pending review",
        })
        save(data)
    except Exception as exc:
        data["lastError"] = str(exc)
        data["stoppedAt"] = now()
        data["status"] = "stopped-requires-inspection-no-automatic-resubmit"
        save(data)
        raise


if __name__ == "__main__":
    main()
