from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


JOBS = [
    ("idle", "idle.txt", 2026082611, True),
    ("running", "running.txt", 2026082612, True),
    ("smg_attacking", "smg_attack.txt", 2026082613, True),
    ("rocket_attacking", "rocket_attack.txt", 2026082614, True),
    ("dying", "dying.txt", 2026082615, False),
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
    completed = []
    for name, prompt_name, seed, loop in JOBS:
        if args.only and args.only != name:
            continue
        output = args.out_dir / f"hamster_anti_vehicle_{name}_h3.mp4"
        command = [
            str(args.python),
            str(args.ai_asset),
            "video",
            "generate",
            "--provider",
            "h3",
            "--ref",
            str(args.ref),
            "--prompt",
            str(args.prompt_dir / prompt_name),
            "--out",
            str(output),
            "--duration",
            "5.17",
            "--size",
            "1024x576",
            "--steps",
            "16",
            "--seed",
            str(seed),
            "--bg-color",
            "#FFFFFF",
            "--timeout",
            "2400",
        ]
        if loop:
            command.append("--loop")
        print(f"[hamster-anti-vehicle-h3] starting {name}: {' '.join(command)}", flush=True)
        subprocess.run(command, check=True)
        completed.append(
            {
                "name": name,
                "provider": "MiniMax H3 ImageToVideo",
                "seed": seed,
                "durationSeconds": 5.17,
                "size": "1024x576",
                "steps": 16,
                "loopLocked": loop,
                "reference": str(args.ref),
                "prompt": str(args.prompt_dir / prompt_name),
                "output": str(output),
            }
        )
        (args.out_dir / "h3-video-manifest.json").write_text(
            json.dumps(completed, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(f"[hamster-anti-vehicle-h3] completed {len(completed)} job(s)", flush=True)


if __name__ == "__main__":
    main()
