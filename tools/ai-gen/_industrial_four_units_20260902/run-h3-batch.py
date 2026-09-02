#!/usr/bin/env python3
"""Run the approved one-candidate MiniMax H3 batch for four industrial units."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools/ai-gen/ai-asset.py"
PROMPTS = ROOT / "h3-prompts"

SHOOTING = REPO / "tools/ai-gen/_industrial_shooting_mothers_20260831/animations"
CAVALRY = REPO / "tools/ai-gen/_industrial_cavalry_mothers_20260831/animations"

SPECS = (
    ("service_rifleman", SHOOTING / "service_rifleman", ("idle", "running", "attacking", "dying")),
    ("emplaced_machine_gun_crew", SHOOTING / "emplaced_machine_gun_crew", ("idle", "running", "attacking", "dying")),
    ("industrial_carbine_cavalry", CAVALRY / "industrial_carbine_cavalry", ("idle", "running", "attacking", "dying")),
    ("gunpowder_explosive_lancer", CAVALRY / "gunpowder_explosive_lancer", ("idle", "running", "attacking", "charging", "dying")),
)

PROMPT_PREFIX = {
    "service_rifleman": "service_rifleman",
    "emplaced_machine_gun_crew": "bar",
    "industrial_carbine_cavalry": "light-cavalry",
    "gunpowder_explosive_lancer": "heavy-cavalry",
}


def main() -> None:
    results = []
    for unit_key, unit_root, actions in SPECS:
        video_dir = unit_root / "videos"
        video_dir.mkdir(parents=True, exist_ok=True)
        for action in actions:
            ref = unit_root / "references" / f"{action}-keyframe-video-safe-16x9.png"
            prompt = PROMPTS / f"{PROMPT_PREFIX[unit_key]}-{action}.txt"
            output = video_dir / f"{action}-h3-v01.mp4"
            if output.exists() and output.stat().st_size > 0:
                print(f"[h3-batch] skip existing {output.relative_to(REPO)}", flush=True)
                results.append({"unitKey": unit_key, "action": action, "status": "existing", "output": str(output.relative_to(REPO)).replace("\\", "/")})
                continue
            command = [
                sys.executable,
                str(TOOL),
                "video", "generate",
                "--provider", "h3",
                "--ref", str(ref),
                "--reference-mode", "first-frame",
                "--prompt", str(prompt),
                "--out", str(output),
                "--duration", "5.17",
                "--size", "1024x576",
                "--steps", "20",
                "--candidates", "1",
                "--h3-audio-mode", "visual-only",
                "--h3-visual-profile", "character-asset",
                "--bg-color", "#FFFFFF",
                "--timeout", "3600",
            ]
            if action in {"idle", "running"}:
                command.append("--loop")
            else:
                command.extend(("--motion-mode", "one-way" if action == "dying" else "recover"))
            for attempt in range(1, 4):
                print(
                    f"[h3-batch] generating {unit_key}/{action} attempt={attempt}/3",
                    flush=True,
                )
                try:
                    subprocess.run(command, cwd=REPO, check=True)
                    break
                except subprocess.CalledProcessError:
                    if attempt >= 3:
                        raise
                    time.sleep(20)
            results.append({"unitKey": unit_key, "action": action, "status": "generated", "output": str(output.relative_to(REPO)).replace("\\", "/")})

    report = {
        "schemaVersion": 1,
        "date": "2026-09-02",
        "provider": "MiniMax H3 on user-owned RTX 5080",
        "durationSeconds": 5.17,
        "size": "1024x576",
        "steps": 20,
        "candidatesPerAction": 1,
        "audioMode": "visual-only",
        "visualProfile": "character-asset",
        "results": results,
    }
    (ROOT / "h3-batch-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
