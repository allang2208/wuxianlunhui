"""Production export: approved keyframes -> common scale/crop -> RIFE -> runtime.

Never interpolate the previous 917-frame sheets. No game/test process is run.
The approved MP4 files and current pre-interpolation source sheets are retained.
"""
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
TOOLS = ROOT.parents[1]
OUT = ROOT / "runtime-build"
ASSETS = REPO / "assets/enemies/deep_vein_mother"
PLAN = {
    "idle": (8, 118, 5000, True),
    "walking": (6, 142, 4000, True),
    "stomp": (6, 120, 2400, False),
    "pipe_blast": (6, 120, 3000, False),
    "vein_resonance": (6, 120, 3200, False),
    "pressure_release": (6, 144, 6000, False),
    "dying": (6, 144, 3400, False),
}
EVENTS = {
    "stomp": {"contactFrame": 24},
    "pipe_blast": {"releaseFrames": [10, 18, 26]},
    "vein_resonance": {"releaseFrame": 20},
    "pressure_release": {"exposedStartFrame": 8, "exposedEndFrame": 33},
}


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def grid(count, width, height):
    choices = []
    for cols in range(1, 4096 // width + 1):
        rows = math.ceil(count / cols)
        if rows * height <= 4096:
            choices.append(((cols * rows - count, abs(cols * width - rows * height)), cols, rows))
    _, cols, rows = min(choices)
    return cols, rows


def pack(cells, cols):
    h, w = cells[0].shape[:2]
    sheet = np.zeros((math.ceil(len(cells) / cols) * h, cols * w, 4), np.uint8)
    for i, cell in enumerate(cells):
        sheet[i // cols * h:(i // cols + 1) * h, i % cols * w:(i % cols + 1) * w] = cell
    return Image.fromarray(sheet)


def prepare(force=False):
    # The committed pre-RIFE sheets are the reproducible source after cleanup.
    # Re-running `all` must not require the removed per-frame BiRefNet cache.
    if not force and (OUT / "manifest.json").exists():
        retained = read(OUT / "manifest.json")
        if all((OUT / "pre-interpolation" / f"{r['state']}.png").exists() for r in retained["actions"]):
            print("Using retained final pre-interpolation source sheets", flush=True)
            return
    task = read(ROOT / "task-index.json")
    jobs = {j["state"]: j for j in task["jobs"]}
    if not task["allSourcesUserApproved"]:
        raise RuntimeError("Source approval required")
    sources, selected = {}, {}
    for state, (step, end, _, loop) in PLAN.items():
        job = jobs[state]
        if not job["approved"] or not (ROOT / job["video"]).is_file():
            raise RuntimeError(f"Missing approved source: {state}")
        ids = list(range(0, end + 1, step))
        if not loop and ids[-1] != end:
            ids.append(end)
        selected[state] = ids
        sources[state] = [np.asarray(Image.open(ROOT / "sprite-build/cutouts" / state / f"f{i:03d}.png").convert("RGBA")) for i in ids]
    # Keep the largest shared body scale fitting the complete 128 MiB family.
    # Selection/crops are derived from source alpha, never from interpolated art.
    for body_height in range(280, 191, -8):
        scale = body_height / 480
        frames, layouts = {}, {}
        for state, cells in sources.items():
            boxes = [Image.fromarray(a[..., 3]).getbbox() for a in cells]
            half = max(max(395-b[0], b[2]-395) for b in boxes) * scale
            width = math.ceil((2*half + 24) / 8) * 8
            top = math.floor((min(b[1] for b in boxes)-660)*scale) - 12
            bottom = math.ceil((max(b[3] for b in boxes)-660)*scale) + 12
            height = math.ceil((bottom-top)/8)*8
            count = len(cells)*2 - int(not PLAN[state][3])
            cols, rows = grid(count, width, height)
            layouts[state] = dict(frameWidth=width, frameHeight=height, frameCount=count,
                                  cols=cols, rows=rows, footY=-top, authoredBodyHeight=body_height,
                                  durationMs=PLAN[state][2], frameRate=count*1000/PLAN[state][2],
                                  repeat=-1 if PLAN[state][3] else 0, **EVENTS.get(state, {}))
        rgba_bytes = sum(l["frameWidth"]*l["frameHeight"]*l["cols"]*l["rows"]*4 for l in layouts.values())
        # Reuse the ore projectile pixels in our own family: referencing the
        # ore_spider directory would make residency load its entire animation set.
        with Image.open(REPO / "assets/enemies/ore_spider/projective.png") as projectile:
            projectile_bytes = projectile.width*projectile.height*4
        if rgba_bytes + projectile_bytes <= 128*1024*1024:
            break
    else:
        raise RuntimeError("No approved-size export fits the boss budget")
    actions = []
    for state, cells in sources.items():
        layout = layouts[state]
        w, h, foot = layout["frameWidth"], layout["frameHeight"], layout["footY"]
        matrix = np.float32([[scale, 0, w/2-395*scale], [0, scale, foot-660*scale]])
        rendered = []
        for cell in cells:
            f = cell.astype(np.float32)/255
            f[..., :3] *= f[..., 3:4]
            f = np.clip(cv2.warpAffine(f, matrix, (w, h), flags=cv2.INTER_LANCZOS4), 0, 1)
            f[..., :3] /= np.maximum(f[..., 3:4], 1e-6)
            rgba = np.clip(np.rint(f*255), 0, 255).astype(np.uint8)
            rgba[rgba[..., 3] == 0, :3] = 0
            rendered.append(rgba)
        key_cols, _ = grid(len(cells), w, h)
        path = OUT / "pre-interpolation" / f"{state}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        pack(rendered, key_cols).save(path)
        actions.append(dict(state=state, label=jobs[state]["label"], sourceVideo=jobs[state]["video"],
                            preInterpolationSheet=f"runtime-build/pre-interpolation/{state}.png",
                            sourceFrames=selected[state], sourceFps=24, keyCols=key_cols,
                            keyCount=len(cells), mode="loop" if PLAN[state][3] else "one-shot",
                            textureKey=f"enemy_deep_vein_mother_{state}",
                            asset=f"assets/enemies/deep_vein_mother/{state}.png", **layout))
    save(OUT / "manifest.json", dict(version=1, profile="boss", assetOnly=False, runtimeIntegrationActive=True,
        sourceApprovalPreserved=True, runtimeValidated=False, sourcePixelScale=scale,
        sourceAnchorX=395, sourceGroundY=660, authoredBodyHeight=body_height, bodyDisplayHeight=300,
        directRgbaBytes=rgba_bytes, dependencyRgbaBytes=projectile_bytes,
        totalRgbaMiB=(rgba_bytes+projectile_bytes)/1024**2,
        policy="Constant cross-action scale and symmetric X crop; stable foot anchor; original source trajectory retained; RIFE only from resampled approved keys.",
        dependencies=[dict(textureKey="enemy_deep_vein_mother_ore_fragment", path="assets/enemies/deep_vein_mother/ore_fragment.png",
                           derivedFrom="assets/enemies/ore_spider/projective.png")], actions=actions))
    print(f"Prepared {sum(l['frameCount'] for l in layouts.values())} frames, body={body_height}px, family={(rgba_bytes+projectile_bytes)/1024**2:.2f} MiB", flush=True)


def interpolate():
    for rec in read(OUT / "manifest.json")["actions"]:
        state = rec["state"]
        report = OUT / "rife-reports" / f"{state}.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        target = ASSETS / f"{state}.png"
        if report.exists() and target.exists():
            continue
        command = [sys.executable, str(TOOLS / "rife-spritesheet-interpolate.py"),
                   "--sheet", str(OUT / "pre-interpolation" / f"{state}.png"), "--out", str(target),
                   "--name", f"deep-vein-mother-runtime-{state}",
                   "--frame-width", str(rec["frameWidth"]), "--frame-height", str(rec["frameHeight"]),
                   "--cols", str(rec["keyCols"]), "--frame-count", str(rec["keyCount"]),
                   "--frame-rate", str(rec["frameRate"]/2), "--mode", rec["mode"],
                   "--out-cols", str(rec["cols"]), "--preview-dir", str(OUT / "rife-previews"),
                   "--report", str(report), "--repair-red-outliers", "--preserve-vertical-motion"]
        print(f"RIFE {state}: {rec['keyCount']} -> {rec['frameCount']}", flush=True)
        with (report.parent / f"{state}.log").open("w", encoding="utf-8") as log:
            subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)


def finish():
    manifest = read(OUT / "manifest.json")
    preview_dir = OUT / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO / "assets/enemies/ore_spider/projective.png", ASSETS / "ore_fragment.png")
    sequences = []
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
    for rec in manifest["actions"]:
        state = rec["state"]
        source = ASSETS / f"{state}.png"
        report = read(OUT / "rife-reports" / f"{state}.json")
        rec["productionReport"] = report["validation"]
        # Integral production safeguards; no standalone test/budget checker.
        if not report["validation"]["originalKeyFramesPreservedAtEvenIndices"]:
            raise RuntimeError(f"Source keys changed: {state}")
        sheet = Image.open(source).convert("RGBA")
        frames = []
        for i in range(rec["frameCount"]):
            w, h, cols = rec["frameWidth"], rec["frameHeight"], rec["cols"]
            cell = sheet.crop((i%cols*w, i//cols*h, (i%cols+1)*w, (i//cols+1)*h))
            # Shared 384px preview canvas/260px body/ground line; no cell stretching.
            scale = 260/manifest["authoredBodyHeight"]
            cell = cell.resize((round(w*scale), round(h*scale)), Image.Resampling.LANCZOS)
            frame = Image.new("RGB", (384, 410), "#252931")
            frame.paste(cell, (192-cell.width//2, round(370-rec["footY"]*scale)), cell)
            draw = ImageDraw.Draw(frame)
            draw.text((8, 5), f"{rec['label']}  {rec['durationMs']/1000:g}s", font=font, fill="white")
            draw.text((8, 382), f"f{i}/{rec['frameCount']-1}", fill="#bac5d1")
            frames.append(frame)
        ticks = [round(i*rec["durationMs"]/rec["frameCount"]/10)*10 for i in range(rec["frameCount"]+1)]
        frames[0].save(preview_dir / f"{state}.gif", save_all=True, append_images=frames[1:],
                       duration=[b-a for a,b in zip(ticks,ticks[1:])], loop=0, disposal=2)
        sequences.append((rec, frames))
    overview = []
    for tick in range(90):
        canvas = Image.new("RGB", (1152, 1230), "#1c2026")
        for n, (rec, frames) in enumerate(sequences):
            elapsed = tick*100
            if rec["repeat"] == -1:
                elapsed %= rec["durationMs"]
            idx = min(len(frames)-1, int(elapsed/rec["durationMs"]*len(frames)))
            canvas.paste(frames[idx], (n%3*384, n//3*410))
        overview.append(canvas)
    overview[0].save(preview_dir / "runtime-overview.gif", save_all=True, append_images=overview[1:], duration=100, loop=0, disposal=2)
    save(OUT / "manifest.json", manifest)
    print(f"Exported runtime sheets and runtime-clock GIFs: {ASSETS}", flush=True)


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    if stage == "prepare-from-video-cache":
        prepare(force=True)
        sys.exit(0)
    for name, fn in (("prepare", prepare), ("interpolate", interpolate), ("finish", finish)):
        if stage in (name, "all"):
            fn()
