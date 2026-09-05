#!/usr/bin/env python3
"""Install the accepted shared bishop/archbishop sheets into runtime assets."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = ROOT / "sheets" / "interpolated"
TARGET = REPO / "assets" / "companions" / "hamster_bishop_archbishop_shared"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-archbishop.png"
ACTIONS = ("idle", "moving", "spellcast", "dying")
CONFIGS = ("hamster-bishop-config.json", "hamster-archbishop-config.json")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_icon(idle_sheet: Path) -> None:
    with Image.open(idle_sheet) as sheet:
        frame = np.asarray(sheet.convert("RGBA").crop((0, 0, 512, 512))).copy()
    ys, xs = np.where(frame[..., 3] > 16)
    if not len(xs):
        raise RuntimeError("Shared idle first frame is empty")
    pad = 10
    x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    x1, y1 = min(512, int(xs.max()) + pad + 1), min(512, int(ys.max()) + pad + 1)
    crop = Image.fromarray(frame[y0:y1, x0:x1], "RGBA")
    scale = min(232 / crop.width, 232 / crop.height)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    subject = crop.resize(size, Image.Resampling.LANCZOS)
    icon = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    icon.alpha_composite(subject, ((256 - size[0]) // 2, (256 - size[1]) // 2))
    ICON.parent.mkdir(parents=True, exist_ok=True)
    icon.save(ICON, optimize=True, compress_level=9)


def update_json(path: Path, patch: dict[str, object]) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    data.update(patch)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    assets = {}
    for action in ACTIONS:
        source = SOURCE / f"{action}.png"
        destination = TARGET / f"{action}.png"
        shutil.copy2(source, destination)
        assets[action] = {
            "source": str(source.relative_to(REPO)).replace("\\", "/"),
            "destination": str(destination.relative_to(REPO)).replace("\\", "/"),
            "sha256": sha256(destination),
        }
    build_icon(TARGET / "idle.png")

    config_copies = {}
    for name in CONFIGS:
        source = REPO / "data" / name
        destination = REPO / "public" / "data" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        config_copies[name] = {
            "destination": str(destination.relative_to(REPO)).replace("\\", "/"),
            "identical": sha256(source) == sha256(destination),
        }

    report = {
        "runtimeIntegrationActive": True,
        "sharedVisualUnits": ["bishop", "archbishop"],
        "sharedAssetDirectory": str(TARGET.relative_to(REPO)).replace("\\", "/"),
        "assets": assets,
        "sharedIcon": {
            "path": str(ICON.relative_to(REPO)).replace("\\", "/"),
            "sha256": sha256(ICON),
        },
        "configCopies": config_copies,
    }
    (ROOT / "runtime-install-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    update_json(ROOT / "task-index.json", {
        "runtimeIntegrationActive": True,
        "status": "runtime_integrated_shared_bishop_archbishop",
        "runtimeInstallReport": "runtime-install-report.json",
    })
    update_json(ROOT / "spritesheet-index.json", {
        "runtimeIntegrationActive": True,
        "runtimeInstallReport": "runtime-install-report.json",
        "runtimeSharedAssetDirectory": "assets/companions/hamster_bishop_archbishop_shared",
    })
    update_json(ROOT / "source-sheet-report.json", {
        "runtimeIntegrationActive": True,
        "runtimeInstallReport": "runtime-install-report.json",
    })
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
