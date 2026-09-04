"""Run the approved offline sprite-production stages with their required venvs."""
from __future__ import annotations

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
COMFY_PYTHON = REPO.parent / "ComfyUI/.venv/Scripts/python.exe"
RIFE_PYTHON = REPO / ".venv-sprites/Scripts/python.exe"


def run(python: Path, stage: str) -> None:
    with (ROOT / f"logs/production-{stage}.log").open("w", encoding="utf-8") as log:
        subprocess.run(
            [str(python), str(ROOT / "make_sprites.py"), stage],
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )
    print(f"{stage}: complete", flush=True)


if __name__ == "__main__":
    for folder in ["source-sheets", "final", "cache/birefnet", "cache/rife-preview", "previews", "logs"]:
        (ROOT / folder).mkdir(parents=True, exist_ok=True)
    run(COMFY_PYTHON, "keys")
    run(RIFE_PYTHON, "interpolate")
    run(COMFY_PYTHON, "package")
