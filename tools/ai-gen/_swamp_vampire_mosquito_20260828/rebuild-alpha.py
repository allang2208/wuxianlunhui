"""Rebuild the approved mosquito videos with calibrated chroma, without re-anchoring.

Run with the ComfyUI Python environment. Outputs remain candidates until copied
to the runtime assets after inspecting the four animation previews.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = ROOT / "alpha-repair-20260830"


def load_tool(name, filename):
    sys.path.insert(0, str(REPO / "tools/ai-gen"))
    spec = importlib.util.spec_from_file_location(name, REPO / "tools/ai-gen" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def finish_middle_frames(action, dest):
    import numpy as np
    from PIL import Image
    hover = load_tool("hover", "build-translucent-hover-sheet.py")
    rife = load_tool("rife", "rife-spritesheet-interpolate.py")
    report = json.loads((dest / "rife.json").read_text(encoding="utf-8"))
    frames = rife.extract_cells(dest / "final.png", report["frameWidth"], report["frameHeight"],
                                report["cols"], report["outputFrameCount"])
    source = json.loads((dest / "source.json").read_text(encoding="utf-8"))
    originals = rife.extract_cells(dest / "source.png", report["frameWidth"], report["frameHeight"],
                                   source["cols"], report["sourceFrameCount"])
    fixed = []
    dark_fixed = []
    for index, frame in enumerate(frames):
        alpha = frame[..., 3].copy()
        count = 0
        dark_count = 0
        if index % 2:
            frame[..., :3], count = hover.remove_green_yellow_fringe(frame[..., :3], alpha)
            pair = index // 2
            frame, dark_count, held = rife.repair_temporal_dark_outliers(
                frame, originals[pair], originals[(pair + 1) % len(originals)])
            if held:
                raise RuntimeError("refusing to replace interpolated motion with a held key frame")
            # Source-color reconstruction may recover a yellow fringe. A final
            # color-only pass samples non-black clean RGB, so it cannot create
            # another opaque dark outlier while removing that recovered color.
            frame[..., :3], restored_fringe = hover.remove_green_yellow_fringe(frame[..., :3], alpha)
            count += restored_fringe
            frames[index] = frame
        if not np.array_equal(alpha, frame[..., 3]):
            raise RuntimeError("RGB fringe repair changed alpha")
        previous = report.get("postprocess", {}).get("recoloredPixels", [0] * len(frames))
        fixed.append(previous[index] + count)
        if index % 2:
            dark_fixed.append(dark_count)
    Image.fromarray(rife.compose(frames, report["cols"])).save(dest / "final.png", optimize=True)
    rife.write_previews(f"swamp-vampire-mosquito-{action}", frames, report["sourceFrameRate"],
                        report["mode"], dest / "preview")
    prior = report["validation"]
    pair_count = len(frames) // 2
    report["validation"] = rife.validate(
        originals, frames, report["mode"], prior["middleFrameFootShifts"],
        [old + new for old, new in zip(prior["middleFrameVisibleDarkPixelsRepaired"], dark_fixed)],
        prior["middleFrameVisibleRedPixelsRepaired"],
        [2 * index + 1 in prior["middleFrameHeldSourceKeyFallbacks"] for index in range(pair_count)],
        False, 0, True, report["blueSpillThreshold"],
    )
    report["postprocess"] = {"type": "green-yellow RGB fringe repair on generated middle frames only",
                              "alphaPreserved": True, "recoloredPixels": fixed}
    (dest / "rife.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def run(command, log):
    with log.open("w", encoding="utf-8") as stream:
        subprocess.run([sys.executable, *map(str, command)], cwd=REPO,
                       stdout=stream, stderr=subprocess.STDOUT, check=True)


def rebuild(action):
    before = OUT / "before"
    before.mkdir(parents=True, exist_ok=True)
    for source, name in [
        (ROOT / "reports/sprites/source-pre-rife" / f"{action}.json", f"{action}-source.json"),
        (ROOT / "reports/sprites/final" / f"{action}-rife.json", f"{action}-rife.json"),
        (ROOT / "spritesheets/source-pre-rife" / f"{action}.png", f"{action}-source.png"),
        (ROOT / "spritesheets/final" / f"{action}.png", f"{action}-final.png"),
    ]:
        if not (before / name).exists():
            shutil.copy2(source, before / name)
    source = json.loads((before / f"{action}-source.json").read_text(encoding="utf-8"))
    final = json.loads((before / f"{action}-rife.json").read_text(encoding="utf-8"))
    dest = OUT / action
    dest.mkdir(exist_ok=True)
    command = [REPO / "tools/ai-gen/ai-asset.py", "monster", "hover-rebuild",
               "--video", source["video"], "--out", dest / "source.png",
               "--frames", ",".join(map(str, source["sourceFrames"])),
               "--cell", "640", "--cell-width", final["frameWidth"],
               "--cell-height", final["frameHeight"], "--cols", source["cols"],
               "--frame-rate", source["frameRate"], "--calibrate-chroma",
               "--placement-report", before / f"{action}-source.json",
               "--support-alpha-threshold", "16", "--support-dilate", "8",
               "--blue-spill-radius", "10", "--blue-spill-threshold", "18",
               "--magenta-spill-radius", "10", "--magenta-spill-threshold", "18",
               "--report", dest / "source.json", "--frames-dir", dest / "keys",
               "--preview-gif", dest / "source.gif", "--contact", dest / "source-contact.png"]
    if source.get("clearRect"):
        command += ["--clear-rect", ",".join(map(str, source["clearRect"]))]
    if source.get("clearOutputRect"):
        command += ["--clear-output-rect", ",".join(map(str, source["clearOutputRect"])),
                    "--clear-output-rect-start", source.get("clearOutputRectStart", 0)]
    print(f"[{action}] recovering {len(source['sourceFrames'])} original video keys", flush=True)
    run(command, dest / "source.log")
    print(f"[{action}] interpolating clean RGB and alpha", flush=True)
    run([REPO / "tools/ai-gen/rife-spritesheet-interpolate.py",
         "--sheet", dest / "source.png", "--out", dest / "final.png",
         "--name", f"swamp-vampire-mosquito-{action}",
         "--frame-width", final["frameWidth"], "--frame-height", final["frameHeight"],
         "--cols", source["cols"], "--frame-count", len(source["sourceFrames"]),
         "--frame-rate", source["frameRate"], "--mode", final["mode"],
         "--out-cols", final["cols"], "--preview-dir", dest / "preview",
         "--report", dest / "rife.json", "--preserve-vertical-motion",
         "--despill-blue-middle", "--repair-magenta-middle"], dest / "rife.log")
    finish_middle_frames(action, dest)
    print(f"[{action}] ready: {dest / 'final.png'}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--actions", nargs="+", choices=["idle", "walking", "attacking", "dying"],
                        default=["idle", "walking", "attacking", "dying"])
    for action in parser.parse_args().actions:
        rebuild(action)
