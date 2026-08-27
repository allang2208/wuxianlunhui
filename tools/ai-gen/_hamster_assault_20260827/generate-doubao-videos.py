#!/usr/bin/env python3
"""Submit versioned hamster-assault action prompts through ai-asset.py."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


JOBS = [
    ("idle", "idle-doubao-v01.txt", True),
    ("running", "running-doubao-v01.txt", True),
    ("attacking", "attacking-doubao-v01.txt", False),
    ("dying", "dying-doubao-v01.txt", False),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--ai-asset", type=Path, required=True)
    parser.add_argument("--ref", type=Path, required=True)
    parser.add_argument("--prompt-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--only", choices=[job[0] for job in JOBS])
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out_dir.parent / "task-index.json"
    completed = json.loads(manifest_path.read_text(encoding="utf-8"))

    for name, prompt_name, loop in JOBS:
        if args.only and args.only != name:
            continue
        output = args.out_dir / f"{name}-doubao-v01.mp4"
        command = [
            str(args.python), str(args.ai_asset), "video", "generate",
            "--provider", "doubao", "--ref", str(args.ref),
            "--prompt", str(args.prompt_dir / prompt_name), "--out", str(output),
            "--duration", "5", "--size", "1024x576", "--candidates", "1",
            "--doubao-model", "Seedance 2.0 Mini",
            "--timeout", "1800",
        ]
        if loop:
            command.append("--loop")
        print(f"[hamster-assault-doubao] starting {name}", flush=True)
        subprocess.run(command, check=True)
        record = next(item for item in completed["tasks"] if item["motion"] == name)
        record.update({
            "status": "completed_candidate",
            "video": f"videos/{output.name}",
            "provenance": f"videos/{output.name}.json",
        })
        manifest_path.write_text(json.dumps(completed, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[hamster-assault-doubao] completed requested job(s)", flush=True)


if __name__ == "__main__":
    main()
