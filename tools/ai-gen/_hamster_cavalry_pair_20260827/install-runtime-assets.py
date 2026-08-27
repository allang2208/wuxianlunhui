#!/usr/bin/env python3
"""Install accepted interpolated sheets and deterministic unit icons."""

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
UNITS = {
    "cavalry": {
        "asset_dir": "hamster_cavalry",
        "icon": "hamster-cavalry.png",
        "config": "hamster-cavalry-config.json",
    },
    "winged_hussar": {
        "asset_dir": "hamster_winged_hussar",
        "icon": "hamster-winged-hussar.png",
        "config": "hamster-winged-hussar-config.json",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_icon(idle_sheet: Path, output: Path) -> None:
    sheet = Image.open(idle_sheet).convert("RGBA")
    frame = np.asarray(sheet.crop((0, 0, 512, 512))).copy()
    ys, xs = np.where(frame[..., 3] > 16)
    if not len(xs):
        raise RuntimeError(f"empty first frame: {idle_sheet}")
    pad = 10
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(512, int(xs.max()) + pad + 1)
    y1 = min(512, int(ys.max()) + pad + 1)
    crop = Image.fromarray(frame[y0:y1, x0:x1], "RGBA")
    scale = min(232 / crop.width, 232 / crop.height)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    crop = crop.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((256 - size[0]) // 2, (256 - size[1]) // 2))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, optimize=True, compress_level=9)


def main() -> None:
    report: dict[str, object] = {
        "source": "sheets/interpolated",
        "pipeline": "BiRefNet-general + RIFE v4.6 RGBA 2x",
        "units": {},
    }
    for unit, spec in UNITS.items():
        source_dir = SOURCE / unit
        asset_dir = REPO / "assets" / "companions" / spec["asset_dir"]
        asset_dir.mkdir(parents=True, exist_ok=True)
        installed: dict[str, object] = {}
        for action in ("idle", "running", "attacking", "dying"):
            source = source_dir / f"{action}.png"
            destination = asset_dir / f"{action}.png"
            shutil.copy2(source, destination)
            installed[action] = {
                "source": str(source.relative_to(REPO)).replace("\\", "/"),
                "destination": str(destination.relative_to(REPO)).replace("\\", "/"),
                "sha256": sha256(destination),
            }

        icon = REPO / "assets" / "ui" / "unit-icons" / spec["icon"]
        build_icon(asset_dir / "idle.png", icon)
        config_source = REPO / "data" / spec["config"]
        config_public = REPO / "public" / "data" / spec["config"]
        config_public.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(config_source, config_public)
        report["units"][unit] = {
            "assets": installed,
            "icon": str(icon.relative_to(REPO)).replace("\\", "/"),
            "iconSha256": sha256(icon),
            "configCopiesIdentical": sha256(config_source) == sha256(config_public),
        }

    (ROOT / "runtime-install-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
