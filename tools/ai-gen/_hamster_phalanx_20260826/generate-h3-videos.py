from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


JOBS = [
    ("idle", "idle-h3.txt", 2026082621, True, "hamster-phalanx-double-axe-white-1024x576.png", "hamster_phalanx_idle_h3.mp4"),
    ("walking", "walking-v02-corrected-axe-h3.txt", 2026082629, True, "walking-v02/hamster-phalanx-double-axe-white-1024x576.png", "hamster_phalanx_walking_h3_v02.mp4"),
    ("attacking", "attacking-h3.txt", 2026082623, True, "hamster-phalanx-double-axe-white-1024x576.png", "hamster_phalanx_attacking_h3.mp4"),
    ("dying", "dying-h3.txt", 2026082624, False, "hamster-phalanx-double-axe-white-1024x576.png", "hamster_phalanx_dying_h3.mp4"),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--ai-asset", type=Path, required=True)
    parser.add_argument("--ref-dir", type=Path, required=True)
    parser.add_argument("--prompt-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--only", choices=[job[0] for job in JOBS])
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out_dir / "h3-video-manifest.json"
    completed = []
    if manifest_path.exists():
        completed = json.loads(manifest_path.read_text(encoding="utf-8"))

    for name, prompt_name, seed, loop, reference_name, output_name in JOBS:
        if args.only and args.only != name:
            continue
        reference = args.ref_dir / reference_name
        output = args.out_dir / output_name
        command = [
            str(args.python),
            str(args.ai_asset),
            "video",
            "generate",
            "--provider",
            "h3",
            "--ref",
            str(reference),
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
        print(f"[hamster-phalanx-h3] starting {name}: {' '.join(command)}", flush=True)
        subprocess.run(command, check=True)
        record = {
            "name": name,
            "provider": "MiniMax H3 ImageToVideo",
            "seed": seed,
            "durationSeconds": 5.17,
            "size": "1024x576",
            "steps": 16,
            "loopLocked": loop,
            "reference": str(reference),
            "prompt": str(args.prompt_dir / prompt_name),
            "output": str(output),
        }
        completed = [item for item in completed if item.get("name") != name]
        completed.append(record)
        manifest_path.write_text(
            json.dumps(completed, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(f"[hamster-phalanx-h3] completed requested job(s)", flush=True)


if __name__ == "__main__":
    main()
