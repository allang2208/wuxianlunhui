#!/usr/bin/env python3
"""Submit versioned cavalry action prompts through the unified Doubao pipeline."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
JOBS = {
    "cavalry": {
        "ref": ROOT / "references" / "hamster-cavalry-safe-white-1024x576.png",
        "motions": (("idle", True), ("running", True), ("attacking", False), ("dying", False)),
    },
    "winged_hussar": {
        "ref": ROOT / "references" / "hamster-winged-hussar-safe-white-1024x576.png",
        "motions": (("idle", True), ("running", True), ("attacking", False), ("dying", False)),
    },
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--ai-asset", type=Path, required=True)
    parser.add_argument("--unit", choices=JOBS, required=True)
    parser.add_argument("--only", choices=("idle", "running", "attacking", "dying"))
    args = parser.parse_args()

    manifest_path = ROOT / "task-index.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    unit_record = next(item for item in manifest["units"] if item["unitKey"] == args.unit)
    out_dir = ROOT / "videos" / args.unit
    out_dir.mkdir(parents=True, exist_ok=True)

    for motion, loop in JOBS[args.unit]["motions"]:
        if args.only and args.only != motion:
            continue
        output = out_dir / f"{motion}-doubao-v01.mp4"
        provenance = Path(f"{output}.json")
        if output.exists() and provenance.exists():
            print(f"[{args.unit}] skip existing {motion}: {output}", flush=True)
            continue
        prompt = ROOT / "prompts" / args.unit / f"{motion}-doubao-v01.txt"
        command = [
            str(args.python), str(args.ai_asset), "video", "generate",
            "--provider", "doubao", "--ref", str(JOBS[args.unit]["ref"]),
            "--prompt", str(prompt), "--out", str(output),
            "--duration", "5", "--size", "1024x576", "--candidates", "1",
            "--doubao-model", "Seedance 2.0 Mini", "--timeout", "1800",
            "--doubao-new-chat",
        ]
        if loop:
            command.append("--loop")
        print(f"[{args.unit}] starting {motion}", flush=True)
        subprocess.run(command, check=True)
        task = next(item for item in unit_record["tasks"] if item["motion"] == motion)
        task.update({
            "status": "completed_candidate",
            "video": f"videos/{args.unit}/{output.name}",
            "provenance": f"videos/{args.unit}/{output.name}.json",
        })
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[{args.unit}] completed requested job(s)", flush=True)


if __name__ == "__main__":
    main()
