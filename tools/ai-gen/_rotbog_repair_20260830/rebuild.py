#!/usr/bin/env python3
"""Rebuild approved beetle keys with BiRefNet, then RIFE and lossless packing.

Use the ComfyUI venv Python. No new artwork, frame sampling, scale, or trajectory
is introduced. `keys` and `finish` write candidates only; `install` copies an inspected
complete candidate set and updates only the two beetle frame-layout records.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parent
REPO = TOOLS.parent.parent
SOURCE = TOOLS / "_rotbog_rhinoceros_beetle_king_20260828"
KING = "rotbogRhinocerosBeetleKing"
BROOD = "smallRotbogRhinocerosBeetle"
sys.path.insert(0, str(TOOLS))


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def extract(path, layout):
    with Image.open(path) as opened:
        sheet = opened.convert("RGBA")
        w, h = layout["frameWidth"], layout["frameHeight"]
        cols = sheet.width // w
        return [np.asarray(sheet.crop((i % cols * w, i // cols * h,
                                      (i % cols + 1) * w, (i // cols + 1) * h))).copy()
                for i in range(layout["frameCount"])]


def pack(cells, path, cols):
    h, w = cells[0].shape[:2]
    rows = math.ceil(len(cells) / cols)
    sheet = Image.new("RGBA", (w * cols, h * rows))
    for i, cell in enumerate(cells):
        sheet.paste(Image.fromarray(cell), (i % cols * w, i // cols * h))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    return {"columns": cols, "rows": rows, "frameWidth": w, "frameHeight": h,
            "frameCount": len(cells), "rgbaBytes": sheet.width * sheet.height * 4}


def columns(count, w, h):
    choices = [(math.ceil(count / c) * c, abs(w * c - h * math.ceil(count / c)), c)
               for c in range(1, count + 1)
               if c * w <= 4096 and math.ceil(count / c) * h <= 4096]
    if not choices:
        raise ValueError("No <=4096 layout; do not silently resize approved frames")
    return min(choices)[2]


def crop_action(cells, original):
    # One symmetric X crop and one Y crop for the entire action, never per-frame fit.
    union = np.any(np.stack([cell[..., 3] > 0 for cell in cells]), axis=0)
    yy, xx = np.where(union)
    if not len(xx):
        raise ValueError("Empty action")
    center = cells[0].shape[1] / 2
    half = math.ceil((max(center - xx.min(), xx.max() + 1 - center) + 8) / 16) * 16
    top = max(0, int(yy.min()) - 8)
    height = math.ceil((int(yy.max()) + 9 - top) / 16) * 16
    box = (int(center - half), top, int(center + half), top + height)
    cropped = [np.asarray(Image.fromarray(cell).crop(box)).copy() for cell in cells]
    return cropped, {"crop": list(box), "footY": original["footY"] - top,
                     "originalFrameWidth": original["frameWidth"],
                     "originalFrameHeight": original["frameHeight"]}


def snapshot():
    path = ROOT / "source-config.json"
    if not path.exists():
        config = read(REPO / "data/enemy-config.json")
        write(path, {kind: config[kind] for kind in (KING, BROOD)})
    config = read(path)
    for kind in (KING, BROOD):
        for state in config[kind]["textures"]["frameLayouts"]:
            source = REPO / config[kind]["textures"][state]
            dest = ROOT / "original" / kind / source.name
            if not dest.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, dest)
    return config


def preview(cells, path, duration_ms, charge=False):
    previews = []
    for cell in cells:
        img = Image.fromarray(cell)
        bg = Image.new("RGBA", img.size, (51, 55, 61, 255))
        bg.alpha_composite(img)
        previews.append(bg.convert("RGB"))
    if charge:
        exact = [900 / 12] * 12 + [1000 / 12] * 12 + [500 / 7] * 7
    else:
        exact = [duration_ms / len(cells)] * len(cells)
    # GIF uses centiseconds. Round cumulative time, not each frame independently.
    end = 0
    cumulative = 0.0
    durations = []
    for ms in exact:
        cumulative += ms
        next_end = round(cumulative / 10) * 10
        durations.append(max(10, next_end - end))
        end = next_end
    path.parent.mkdir(parents=True, exist_ok=True)
    previews[0].save(path, save_all=True, append_images=previews[1:],
                     duration=durations, loop=0, disposal=2)
    thumb_w = min(240, previews[0].width)
    thumb_h = round(previews[0].height * thumb_w / previews[0].width)
    contact = Image.new("RGB", (thumb_w * 5, (thumb_h + 20) * math.ceil(len(cells) / 5)), (42, 45, 50))
    draw = ImageDraw.Draw(contact)
    for i, img in enumerate(previews):
        x, y = i % 5 * thumb_w, i // 5 * (thumb_h + 20)
        contact.paste(img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 3, y + thumb_h + 2), str(i), fill="white")
    contact.save(path.with_suffix(".png"))


def build_keys(config, selected):
    from rmbg_cutout import get_model, predict_alpha
    builder = module("approved_rotbog", SOURCE / "build-rotbog-sheets.py")
    chroma = module("beetle_chroma", TOOLS / "build-translucent-hover-sheet.py")
    model = get_model()
    for state in selected:
        name = {"walk": "walking", "attack": "attacking"}.get(state, state)
        settings = builder.ACTIONS[name]
        report = read(SOURCE / "spritesheets/reports" / f"{name}-key.json")
        source_frames = report["sourceFrames"]
        source_center = report["sourceCore"]
        shifts = [0] * len(source_frames)
        if state == "charge":
            placement = read(SOURCE / "spritesheets/reports/charge-mosquito-clean-v4-key.json")
            runtime = read(SOURCE / "spritesheets/runtime/charge-key-report.json")
            source_frames = runtime["sourceFrames"]
            source_center = placement["coreCenters"][0]
            shifts = [round(384 - x) for x in runtime["sourceCoreX"]]
        elif state == "dying":
            shifts = read(SOURCE / "spritesheets/reports/dying-horizontal-align.json")["integerShiftX"]
        layout = config[KING]["textures"]["frameLayouts"][state]
        decoded = builder.decode(SOURCE / "videos" / settings["video"])
        cells = []
        # Pink is the authored membrane colour in these actions, not key spill.
        # A generic magenta-fringe remover would punch holes through the wings.
        has_pink_wings = state in ("phase_open", "enraged_idle")
        for index, source_index in enumerate(source_frames):
            rgb = decoded[source_index]
            matte = np.asarray(predict_alpha(model, Image.fromarray(rgb)), dtype=np.uint8)
            bg = chroma.sample_chroma_plate(rgb, np.array([0, 0, 255]), matte)
            rgba, _ = chroma.recover_rgba(rgb, bg, matte, support_threshold=16,
                support_dilate=1, blue_spill_radius=2, blue_spill_threshold=18,
                magenta_spill_radius=0 if has_pink_wings else 2,
                magenta_spill_threshold=18, calibrated_plate=True)
            # Remove unsupported matte itself; recoloring a wide halo grey is not a cutout repair.
            rgba[..., 3] = np.minimum(rgba[..., 3], matte)
            rgba[rgba[..., 3] < 3] = 0
            scale = report["scale"]
            matrix = np.array([[scale, 0, report["targetCore"][0] - scale * source_center[0] + shifts[index]],
                               [0, scale, report["targetCore"][1] - scale * source_center[1]]], np.float32)
            size = (layout["frameWidth"], layout["frameHeight"])
            # Premultiplied resampling protects dark, thin legs from transparent RGB fringes.
            alpha = rgba[..., 3].astype(np.float32) / 255
            premult = rgba[..., :3].astype(np.float32) * alpha[..., None]
            warped_alpha = np.clip(cv2.warpAffine(alpha, matrix, size, flags=cv2.INTER_LANCZOS4), 0, 1)
            warped_rgb = cv2.warpAffine(premult, matrix, size, flags=cv2.INTER_LANCZOS4)
            straight = np.clip(warped_rgb / np.maximum(warped_alpha[..., None], 1e-5), 0, 255)
            cell = np.dstack((straight.astype(np.uint8), np.round(warped_alpha * 255).astype(np.uint8)))
            cell[cell[..., 3] < 3] = 0
            cells.append(cell)
            print(f"{state}: source {source_index} ({index + 1}/{len(source_frames)})", flush=True)
        cells, crop = crop_action(cells, layout)
        out_cols = columns(layout["frameCount"], cells[0].shape[1], cells[0].shape[0])
        key = ROOT / "keys" / f"{state}.png"
        info = pack(cells, key, min(out_cols, len(cells)))
        info.update(crop)
        info.update(sourceVideo=str(SOURCE / "videos" / settings["video"]),
                    sourceFrames=source_frames, scale=report["scale"], outColumns=out_cols,
                    preservePinkWings=has_pink_wings)
        write(ROOT / "keys" / f"{state}.json", info)
        duration = layout.get("duration", layout["frameCount"] * 1000 / layout.get("frameRate", 15))
        preview(cells, ROOT / "key-previews" / f"{state}.gif", duration)


def finish(config):
    manifest = {"status": "candidate-not-installed", "sourceScaleChanged": False,
                "trajectoryChanged": False, "rgbBleedRadius": 3,
                "middleRecomposition": "chroma RGB with independent RIFE alpha support (8px)",
                "pinkWingActions": ["phase_open", "enraged_idle"], "actions": {}}
    for state, layout in config[KING]["textures"]["frameLayouts"].items():
        key = read(ROOT / "keys" / f"{state}.json")
        key["preservePinkWings"] = state in ("phase_open", "enraged_idle")
        out = ROOT / "final" / KING / Path(config[KING]["textures"][state]).name
        out.parent.mkdir(parents=True, exist_ok=True)
        duration = layout.get("duration", layout["frameCount"] * 1000 / layout.get("frameRate", 15))
        report = ROOT / "rife-reports" / f"{state}.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        command = [sys.executable, str(ROOT / "rife-colour-bridge.py"),
            "--sheet", str(ROOT / "keys" / f"{state}.png"), "--out", str(out),
            "--name", f"rotbog-{state}", "--frame-width", str(key["frameWidth"]),
            "--frame-height", str(key["frameHeight"]), "--cols", str(key["columns"]),
            "--frame-count", str(key["frameCount"]),
            "--frame-rate", str(layout["frameCount"] * 500 / duration),
            "--mode", "loop" if layout["repeat"] == -1 else "one-shot",
            "--out-cols", str(key["outColumns"]), "--report", str(report),
            "--preview-dir", str(ROOT / "rife-previews"), "--repair-red-outliers",
            "--despill-blue-middle", "--preserve-vertical-motion"]
        if state not in ("phase_open", "enraged_idle"):
            command.append("--repair-magenta-middle")
        subprocess.run(command, check=True)
        rife_report = read(report)
        rife_report["interpolation"] = "RIFE v4.6 separate RGB/alpha, inverse-chroma middle silhouette with RIFE alpha support"
        write(report, rife_report)
        final_layout = {**layout, "frameWidth": key["frameWidth"], "frameHeight": key["frameHeight"],
                        "columns": key["outColumns"], "rows": math.ceil(layout["frameCount"] / key["outColumns"]),
                        "footY": key["footY"]}
        cells = extract(out, final_layout)
        manifest["actions"][f"{KING}/{state}"] = {"layout": final_layout, "source": key,
            "path": str(out.relative_to(ROOT)), "rgbaBytes": final_layout["columns"] * final_layout["rows"]
                * key["frameWidth"] * key["frameHeight"] * 4}
        preview(cells, ROOT / "previews" / f"{state}.gif", duration, charge=state == "charge")
    # Brood keeps one shared crop for all four states, matching its existing shared canvas.
    # This avoids introducing state-dependent geometry into its inherited animation path.
    brood_cells = {}
    for state, layout in config[BROOD]["textures"]["frameLayouts"].items():
        filename = Path(config[BROOD]["textures"][state]).name
        brood_cells[state] = extract(ROOT / "original" / BROOD / filename, layout)
    _, shared_crop = crop_action([cell for cells in brood_cells.values() for cell in cells],
                                config[BROOD]["textures"]["frameLayouts"]["idle"])
    # Summoned units keep all existing pixels and interpolated frames: transparent packing only.
    for state, layout in config[BROOD]["textures"]["frameLayouts"].items():
        filename = Path(config[BROOD]["textures"][state]).name
        cells = [np.asarray(Image.fromarray(cell).crop(shared_crop["crop"])).copy()
                 for cell in brood_cells[state]]
        crop = {**shared_crop, "footY": layout["footY"] - shared_crop["crop"][1]}
        out = ROOT / "final" / BROOD / filename
        packed = pack(cells, out, columns(len(cells), cells[0].shape[1], cells[0].shape[0]))
        final_layout = {**layout, **{k: v for k, v in packed.items() if k != "rgbaBytes"}, "footY": crop["footY"]}
        manifest["actions"][f"{BROOD}/{state}"] = {"layout": final_layout, "source": crop,
            "path": str(out.relative_to(ROOT)), "rgbaBytes": packed["rgbaBytes"]}
    manifest["rgbaBytes"] = sum(item["rgbaBytes"] for item in manifest["actions"].values())
    write(ROOT / "manifest.json", manifest)


def install():
    manifest = read(ROOT / "manifest.json")
    if len(manifest["actions"]) != 12:
        raise ValueError("Require all eight boss and four brood actions")
    if manifest["rgbaBytes"] > 256 * 1024 * 1024:
        raise ValueError("Boss dependency set exceeds admission limit; no silent downscale")
    # Preserve every unrelated config byte, including concurrent edits outside these records.
    for config_path in (REPO / "data/enemy-config.json", REPO / "public/data/enemy-config.json"):
        text = config_path.read_text(encoding="utf-8-sig")
        for kind in (KING, BROOD):
            start = text.index(f'  "{kind}": ') + len(f'  "{kind}": ')
            content, length = json.JSONDecoder().raw_decode(text[start:])
            for state in content["textures"]["frameLayouts"]:
                entry = manifest["actions"][f"{kind}/{state}"]
                content["textures"]["frameLayouts"][state].update({
                    key: entry["layout"][key]
                    for key in ("frameWidth", "frameHeight", "columns", "rows", "footY")
                })
                destination = REPO / content["textures"][state]
                shutil.copy2(ROOT / entry["path"], destination)
            idle = content["textures"]["frameLayouts"]["idle"]
            # Match the new canvas on the first render as well as subsequent
            # per-state updates; this is a visual offset, not a collider move.
            content["render"]["footOffsetY"] = round(
                (idle["footY"] - idle["frameHeight"] / 2)
                * content["render"]["spriteSize"] / content["textures"]["referenceCell"], 6)
            replacement = json.dumps(content, ensure_ascii=False, indent=2).replace("\n", "\n  ")
            text = text[:start] + replacement + text[start + length:]
        config_path.write_text(text, encoding="utf-8")
    manifest["status"] = "installed-runtime-unverified"
    write(ROOT / "manifest.json", manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("keys", "finish", "install"))
    parser.add_argument("--actions", help="comma-separated keys for a focused candidate pass")
    args = parser.parse_args()
    if args.stage == "install":
        install()
    else:
        source_config = snapshot()
        if args.stage == "keys":
            build_keys(source_config, args.actions.split(",") if args.actions
                       else list(source_config[KING]["textures"]["frameLayouts"]))
        else:
            finish(source_config)
