from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
AI_ASSET = ROOT.parent / "ai-asset.py"
REF = ROOT / "video" / "zombie-dog-h3-white.png"

ACTIONS = [
    ("zombie-dog-idle", "idle", "zombie-dog-idle.txt", "zombie-dog-idle.mp4", 23001, False),
    ("zombie-dog-walking", "run", "zombie-dog-walk.txt", "zombie-dog-walking.mp4", 23002, False),
    ("zombie-dog-running", "run", "zombie-dog-run.txt", "zombie-dog-running.mp4", 23003, False),
    ("zombie-dog-attacking", "attack", "zombie-dog-attack.txt", "zombie-dog-attacking.mp4", 23104, False),
    ("zombie-dog-dying", "die", "zombie-dog-die.txt", "zombie-dog-dying.mp4", 23005, True),
]


def main():
    for name, kind, prompt_name, out_name, seed, one_way in ACTIONS:
        cmd = [
            sys.executable,
            str(AI_ASSET),
            "humanoid",
            "video",
            "--name",
            name,
            "--kind",
            kind,
            "--ref",
            str(REF),
            "--prompt",
            str(ROOT / "prompts" / prompt_name),
            "--out",
            str(ROOT / "video" / out_name),
            "--duration",
            "5.17",
            "--size",
            "1344x768",
            "--steps",
            "16",
            "--seed",
            str(seed),
            "--timeout",
            "1800",
        ]
        if one_way:
            cmd.append("--one-way")
        print(f"[zombie-dog] generating {out_name}", flush=True)
        subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
