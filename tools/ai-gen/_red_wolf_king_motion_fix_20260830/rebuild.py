"""Rebuild RedWolfKing's two forms at fixed body scale, using accepted source keys."""
from pathlib import Path
import argparse
import importlib.util
import json
import math
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
AI = ROOT.parent
WOLF = AI / "_red_wolf_king_style_refresh_20260827"
WEREWOLF = AI / "_red_wolf_king_werewolf_doubao_20260827"


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


def extract(path, cols, count, w, h):
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    return [sheet[i // cols * h:(i // cols + 1) * h,
                  i % cols * w:(i % cols + 1) * w].copy() for i in range(count)]


def grid(count, w, h):
    choices = [(cols * math.ceil(count / cols) - count,
                abs(math.log((cols * w) / (math.ceil(count / cols) * h))), cols)
               for cols in range(1, count + 1)
               if cols * w <= 4096 and math.ceil(count / cols) * h <= 4096]
    if not choices:
        raise RuntimeError(f"No single-sheet layout <=4096 for {count}x{w}x{h}")
    return min(choices)[2]


def compose(frames, cols, path):
    h, w = frames[0].shape[:2]
    sheet = Image.new("RGBA", (cols * w, math.ceil(len(frames) / cols) * h))
    for i, frame in enumerate(frames):
        sheet.paste(Image.fromarray(frame), (i % cols * w, i // cols * h))
    sheet.save(path, optimize=True)


def frame_times(name, count):
    if name == "idle": return [200] * count
    if name == "run": return [21] * count
    if name == "werewolfIdle": return [90] * count
    if name == "werewolfRun": return [1000 / 24] * count
    if name in ("pounce", "werewolfPounce"):
        prep = 18 if name == "pounce" else 8
        return [900 / prep] * prep + [900 / (count - prep)] * (count - prep)
    total = 900 if name == "werewolfAttack" else 1200 if name == "attack" else 3000 if "howl" in name.lower() else 2000
    return [total / count] * count


def previews(name, frames, layout):
    scale = 151 / 512 * (1.8 if name.startswith("werewolf") else 1) * 2
    rendered = []
    for i, frame in enumerate(frames):
        # Same pixels/world scale for the whole form; never fit each pose to its bbox.
        form_scale = scale
        if name == "transform": form_scale *= 1 + 0.8 * i / max(1, len(frames) - 1)
        sprite = Image.fromarray(frame).resize((round(frame.shape[1] * form_scale), round(frame.shape[0] * form_scale)), Image.Resampling.LANCZOS)
        tile = Image.new("RGB", (900, 500), "#30343a")
        tile.paste(sprite, (round(320 - layout.get("footX", frame.shape[1] / 2) * form_scale), round(450 - layout["footY"] * form_scale)), sprite)
        ImageDraw.Draw(tile).text((12, 480), name, fill="white")
        rendered.append(tile)
    times = frame_times(name, len(frames))
    sums = np.cumsum([0, *times])
    durations = [max(10, round(sums[i + 1] / 10) * 10 - round(sums[i] / 10) * 10) for i in range(len(frames))]
    rendered[0].save(ROOT / "previews" / f"{name}.gif", save_all=True, append_images=rendered[1:],
                     duration=durations, loop=0, disposal=2, optimize=False)
    indices = list(range(len(frames)))
    contact = Image.new("RGB", (6 * 450, math.ceil(len(indices) / 6) * 268), "#30343a")
    for j, i in enumerate(indices):
        contact.paste(rendered[i].resize((450, 250)), (j % 6 * 450, j // 6 * 268))
        ImageDraw.Draw(contact).text((j % 6 * 450 + 8, j // 6 * 268 + 251), str(i), fill="white")
    contact.save(ROOT / "previews" / f"{name}-contact.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actions", nargs="+")
    parser.add_argument("--reuse-dense-keys", action="store_true")
    parser.add_argument("--reuse-interpolation", action="store_true")
    args = parser.parse_args()
    wolf = module("red_wolf_build", WOLF / "build-runtime-sheets.py")
    werewolf = module("red_werewolf_build", WEREWOLF / "build-werewolf-v02-sheets.py")
    cleaner = module("red_werewolf_clean", WEREWOLF / "finalize-werewolf-v02-sheets.py")
    before = json.loads((ROOT / "before/animation-config.json").read_text(encoding="utf-8"))
    specs = {}
    for key, spec in wolf.SPECS.items():
        name = "run" if key == "running" else key
        specs[name] = (WOLF, spec, WOLF / "sheets/source-keyframes" / f"{key}-keyframes.png", spec["cell"])
    for key, spec in werewolf.SPECS.items():
        name = "transform" if key == "transform" else "werewolf" + {"run":"Run", "attack":"Attack", "pounce":"Pounce", "idle":"Idle", "howl":"Howl", "dying":"Dying"}[key]
        specs[name] = (WEREWOLF, spec, WEREWOLF / "sheets/source-keyframes-v02" / spec.get("key_output", f"{key}-keyframes.png"), spec.get("cell", 640))
    for folder in ("source", "interpolated-full", "sheets", "reports", "previews"):
        (ROOT / folder).mkdir(exist_ok=True)
    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"actions": {}}
    manifest.update({"referenceCell": 512, "pixelScaleChanged": False, "werewolfVisualScale": 1.8,
                     "werewolfCollisionScale": 1.8, "runtimeTestsRun": False})
    for name, (task, spec, source, cell) in specs.items():
        if args.actions and name not in args.actions: continue
        indices = spec["frames"]
        dense = name in ("pounce", "werewolfAttack")
        native_frames = None
        sparse_native = {}
        if dense:
            indices = list(range(0, 73 if name == "pounce" else 61, 3))
            source = ROOT / "source" / f"{name}-keyframes.png"
            native_source = ROOT / "source" / f"{name}-native.png"
            if not args.reuse_dense_keys or not native_source.exists():
                command = [sys.executable, str(AI / "rebuild-h3-birefnet.py"), "--video", str(task / "videos" / spec["video"]),
                           "--out", str(native_source), "--frames", ",".join(map(str, range(indices[-1] + 1))), "--cols", "4", "--cell", str(cell),
                           "--center-x", str(spec.get("center", spec.get("center_x")) + (64 if name == "pounce" else 0)),
                           "--feet-y", str(before["animation"]["frameLayouts"][name]["footY"]),
                           "--target-h", str(262 if name == "pounce" else 290), "--scale", str(spec["scale"]),
                           "--hard-edge", "245", "--edge-dark", "18", "--zero-transparent-rgb",
                           "--bg-color", "#00D9FF" if name == "pounce" else "#00E5FF",
                           "--bg-dist", "48" if name == "pounce" else "52", "--keep-dx"]
                command += ["--motion-anchor", "bbox"]
                if name == "pounce": command.append("--keep-dy")
                subprocess.run(command, check=True)
            native_frames = extract(native_source, 4, indices[-1] + 1, cell, cell)
            for frame in native_frames: cleaner.clean_frame(frame)
            compose([native_frames[i] for i in indices], 4, source)
        elif name in ("transform", "dying") or name.startswith("werewolf"):
            # These accepted videos have genuine intervening poses; avoid RGB/
            # alpha flow disagreement on the turning torso, tail and limbs.
            pairs = list(zip(indices, indices[1:]))
            if spec["mode"] == "loop":
                pairs.append((indices[-1], indices[-1] + 2 if name == "werewolfRun" else indices[0]))
            middle_indices = {i*2+1: (a+b+1)//2 for i,(a,b) in enumerate(pairs)}
            if name == "werewolfPounce": middle_indices.update({9:34,11:37})
            selected = [indices[0], *dict.fromkeys(middle_indices.values())]
            native_source = ROOT / "source" / f"{name}-native-middles.png"
            if not args.reuse_dense_keys or not native_source.exists():
                command = [sys.executable, str(AI / "rebuild-h3-birefnet.py"), "--video", str(task / "videos" / spec["video"]),
                           "--out", str(native_source), "--frames", ",".join(map(str,selected)), "--cols", "4", "--cell", str(cell),
                           "--center-x", str(spec.get("center_x", spec.get("center"))), "--feet-y", str(before["animation"]["frameLayouts"][name]["footY"]),
                           "--target-h", str(spec.get("target_h", 262)), "--scale", str(spec["scale"]),
                           "--hard-edge", "245", "--edge-dark", "18", "--zero-transparent-rgb", "--bg-color", "#00D9FF" if task == WOLF else "#00E5FF",
                           "--bg-dist", "48" if task == WOLF else "52"]
                if spec["keep_dx"]: command += ["--keep-dx", "--motion-anchor", spec.get("motion_anchor", "legs")]
                if spec.get("keep_dy"): command.append("--keep-dy")
                subprocess.run(command, check=True)
            native_cells = extract(native_source, 4, len(selected), cell, cell)
            for frame in native_cells: cleaner.clean_frame(frame)
            sparse_native = {i: (f, native_cells[selected.index(f)]) for i,f in middle_indices.items()}
        source_cols = 4 if dense else spec["key_cols"]
        full = ROOT / "interpolated-full" / f"{name}.png"
        report_path = ROOT / "reports" / f"{name}.json"
        count = len(indices) * 2 - (spec["mode"] == "one-shot")
        avg_fps = count / (sum(frame_times(name, count)) / 1000)
        command = [sys.executable, str(AI / "rife-spritesheet-interpolate.py"), "--sheet", str(source), "--out", str(full),
                   "--name", name, "--frame-width", str(cell), "--frame-height", str(cell), "--cols", str(source_cols),
                   "--frame-count", str(len(indices)), "--frame-rate", str(avg_fps / 2), "--mode", spec["mode"],
                   "--out-cols", "4", "--preview-dir", str(ROOT / "previews/rife"), "--report", str(report_path), "--repair-red-outliers"]
        if name in ("pounce", "werewolfPounce"): command.append("--preserve-vertical-motion")
        if not args.reuse_interpolation or not full.exists():
            subprocess.run(command, check=True)
        frames = extract(full, 4, count, cell, cell)
        original_keys = extract(source, source_cols, len(indices), cell, cell)
        for i, frame in enumerate(original_keys):
            frame[frame[..., 3] == 0, :3] = 0
            frames[i * 2] = frame.copy()
        native_middle = {}
        if native_frames is not None:
            # Fast silhouettes remain unstable when RGB and alpha optical flow
            # disagree. Use distinct intervening source poses, never held keys.
            for i, (a, b) in enumerate(zip(indices, indices[1:])):
                native_index = (a + b + 1) // 2
                frames[i * 2 + 1] = native_frames[native_index].copy()
                native_middle[i * 2 + 1] = native_index
        native_ground_shifts = {}
        for i, (native_index, native_frame) in sparse_native.items():
            if name in ("dying", "werewolfDying"):
                # Source background specks can affect pre-clean crop alignment.
                # Death stays on the established footline after final matting;
                # translate only, preserving the native pose and pixel scale.
                bottom = Image.fromarray(native_frame).getbbox()[3]
                target = round((Image.fromarray(frames[i-1]).getbbox()[3]
                                + Image.fromarray(frames[i+1]).getbbox()[3]) / 2)
                native_ground_shifts[i] = target - bottom
                native_frame = wolf.shift_cell(native_frame, target - bottom)
            frames[i] = native_frame.copy()
            native_middle[i] = native_index
        if name == "werewolfPounce":
            old = extract(ROOT / "before/werewolf_pouncing.png", 5, 27, cell, cell)
            for index in (9, 11): frames[index] = old[index]  # Accepted native f34/f37 replacements.
        repaired = sum(cleaner.clean_frame(frame) for i, frame in enumerate(frames)
                       if i % 2 and not native_middle and not (name == "werewolfPounce" and i in (9, 11)))
        boxes = [Image.fromarray(frame).getbbox() for frame in frames]
        left = max(0, min(min(box[0] for box in boxes) - 4, cell - max(box[2] for box in boxes) - 4))
        top = max(0, min(box[1] for box in boxes) - 4)
        bottom = min(cell, max(box[3] for box in boxes) + 4)
        cropped = [frame[top:bottom, left:cell-left].copy() for frame in frames]
        h, w = cropped[0].shape[:2]
        cols = grid(count, w, h)
        output = ROOT / "sheets" / Path(before["sprites"][name]).name
        compose(cropped, cols, output)
        layout = {"cols": cols, "rows": math.ceil(count / cols), "frames": count,
                  "frameWidth": w, "frameHeight": h, "footY": before["animation"]["frameLayouts"][name]["footY"] - top,
                  "footX": spec.get("center", spec.get("center_x", cell/2)) + (64 if name == "pounce" else 0) - left}
        keys_preserved = all(np.array_equal(frame[top:bottom,left:cell-left], cropped[i*2]) for i,frame in enumerate(original_keys))
        manifest["actions"][name] = {"sourceVideo": str((task / "videos" / spec["video"]).relative_to(REPO)),
            "sourceKeys": str(source.relative_to(REPO)), "sourceIndices": indices, "sourceCols": source_cols, "sourceCell": cell,
            "layout": layout, "crop": [left,top,cell-left,bottom], "pixelResize": False,
            "runtimePath": before["sprites"][name], "sheet": str(output.relative_to(ROOT)), "mode": spec["mode"],
            "frameDurationsMs": frame_times(name,count), "keysPreservedAfterCrop": keys_preserved,
            "postRifeCyanPixelsRepaired": repaired, "rgbaMiB": cols*math.ceil(count/cols)*w*h*4/2**20,
            "interpolationReport": str(report_path.relative_to(ROOT)), "previewGif": f"previews/{name}.gif"}
        if native_middle:
            manifest["actions"][name]["nativeMiddleFrames"] = native_middle
            manifest["actions"][name]["nativeFrameSheet"] = str(native_source.relative_to(REPO))
        if native_ground_shifts: manifest["actions"][name]["nativeDeathGroundShifts"] = native_ground_shifts
        if name == "werewolfPounce": manifest["actions"][name]["retainedNativeReplacementFrames"] = {9:34,11:37}
        previews(name, cropped, layout)
        manifest["rgbaMiB"] = sum(action["rgbaMiB"] for action in manifest["actions"].values())
        manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
        print(f"[red-wolf-fix] {name}: {count} frames, {w}x{h}, {cols} columns, keys preserved={keys_preserved}",flush=True)


if __name__ == "__main__": main()
