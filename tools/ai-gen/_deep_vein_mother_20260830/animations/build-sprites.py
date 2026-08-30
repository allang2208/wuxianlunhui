"""Task-local production of the seven user-approved Deep Vein Mother animations.

Shared entry: ai-asset.py cutout; bulk masks use its rmbg_cutout module.
No regeneration, geometric pose correction, runtime writes or game tests.
"""
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parents[1]
BUILD = ROOT / "sprite-build"
sys.path.insert(0, str(TOOLS))


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def jobs():
    data = read(ROOT / "task-index.json")
    if not data.get("allSourcesUserApproved"):
        raise RuntimeError("Current sources are not approved")
    for job in data["jobs"]:
        if not job.get("approved") or not (ROOT / job["video"]).is_file():
            raise RuntimeError(f"Missing or unapproved source: {job['state']}")
    return data["jobs"]


def decode(job):
    with av.open(str(ROOT / job["video"])) as video:
        stream = video.streams.video[0]
        fps = float(stream.average_rate)
        frames = [np.asarray(f.to_image().convert("RGB")) for f in video.decode(stream)]
    meta = job["returnedVideo"]
    if fps != meta["sourceFps"] or len(frames) != meta["sourceFrames"]:
        raise RuntimeError(f"Approved source inventory changed: {job['video']}")
    return frames, fps


def indices(job):
    # Keep the complete approved trajectory. Exclude only the duplicate loop
    # endpoint; one-shot actions explicitly retain the original corpse/recovery.
    end = job["returnedVideo"]["sourceFrames"] - int(job["loop"])
    return list(range(0, end, 2))


def prepare():
    records = []
    for job in jobs():
        frames, fps = decode(job)
        records.append({"state": job["state"], "sourceVideo": job["video"],
                        "sourceFrameIndices": indices(job), "sourceFps": fps,
                        "policy": "Full source motion; loop endpoint excluded, one-shot last frame retained."})
        dest = BUILD / "references" / f"{job['state']}-f000.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(frames[0]).save(dest)
    save(BUILD / "selection.json", records)


def box(rgba):
    ys, xs = np.where(rgba[..., 3] > 24)
    if not len(xs):
        raise RuntimeError("Empty foreground")
    return tuple(map(int, (xs.min(), ys.min(), xs.max()+1, ys.max()+1)))


def clean(rgb, alpha):
    alpha = np.squeeze(np.asarray(alpha))
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]))
    count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 24).astype(np.uint8), 8)
    if count < 2:
        raise RuntimeError("Empty BiRefNet mask")
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h, _ = stats[main]
    keep = labels == main
    for k in range(1, count):
        cx, cy, cw, ch, area = stats[k]
        # Retain small attached details / nearby solid approved death debris.
        if area >= 12 and cx < x+w+48 and cx+cw > x-48 and cy < y+h+40 and cy+ch > y-40:
            keep |= labels == k
    alpha[~keep] = 0
    alpha[alpha <= 24] = 0
    opaque = alpha >= 224
    if not opaque.any():
        raise RuntimeError("No opaque body")
    edge = (alpha > 0) & ~opaque
    nearest = distance_transform_edt(~opaque, return_distances=False, return_indices=True)
    rgb = rgb.copy()
    rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]
    rgb[alpha == 0] = 0
    return np.dstack((rgb, alpha))


def cutouts():
    from rmbg_cutout import get_model, predict_alpha
    model = None
    for job in jobs():
        frames, _ = decode(job)
        selected = indices(job)
        dest = BUILD / "cutouts" / job["state"]
        dest.mkdir(parents=True, exist_ok=True)
        for pos, index in enumerate(selected):
            out = dest / f"f{index:03d}.png"
            if not out.exists():
                seed = BUILD / "references/idle-f000-alpha.png"
                if job["state"] == "idle" and index == 0 and seed.exists():
                    alpha = np.asarray(Image.open(seed).convert("L"))
                else:
                    if model is None:
                        model = get_model()
                    alpha = predict_alpha(model, Image.fromarray(frames[index]))
                Image.fromarray(clean(frames[index], alpha), "RGBA").save(out)
            if pos % 10 == 0 or pos == len(selected)-1:
                print(f"[BiRefNet] {job['state']} {pos+1}/{len(selected)}", flush=True)


def checker(rgba):
    yy, xx = np.indices(rgba.shape[:2])
    gray = np.where(((xx//24+yy//24)%2)[..., None], 58, 82)
    bg = np.repeat(gray, 3, axis=2)
    a = rgba[..., 3:4].astype(np.float32)/255
    return Image.fromarray(np.clip(rgba[..., :3]*a+bg*(1-a), 0, 255).astype(np.uint8))


def timing(count, fps):
    bounds = [round(i*100/fps) for i in range(count+1)]
    return [(bounds[i+1]-bounds[i])*10 for i in range(count)]


def preview(cells, path, fps):
    path.parent.mkdir(parents=True, exist_ok=True)
    images = [checker(cell).resize((384, 384), Image.Resampling.LANCZOS) for cell in cells]
    images[0].save(path.with_suffix(".gif"), save_all=True, append_images=images[1:],
                   duration=timing(len(cells), fps), loop=0, disposal=2, optimize=False)
    selected = sorted(set(round(i*(len(cells)-1)/23) for i in range(24)))
    contact = Image.new("RGB", (1024, 6*280), "#20242a")
    draw = ImageDraw.Draw(contact)
    for pos, i in enumerate(selected):
        x, y = pos%4*256, pos//4*280
        contact.paste(checker(cells[i]).resize((256, 256)), (x, y))
        draw.text((x+5, y+260), f"f{i} / {i/fps:.3f}s", fill="white")
    contact.save(path.parent / f"{path.name}-contact.png")


def compose():
    sources = {}
    extents = []
    for job in jobs():
        cells = [np.asarray(Image.open(BUILD/"cutouts"/job["state"]/f"f{i:03d}.png").convert("RGBA")) for i in indices(job)]
        sources[job["state"]] = cells
        extents.extend(box(cell) for cell in cells)
    ref = sources["idle"][0]
    solid = ref[..., 3] > 128
    bx, by, ex, ey = box(ref)
    row_width = solid.sum(axis=1)
    body_top = int(np.flatnonzero(row_width >= row_width.max()*0.45)[0])
    source_height = ey-body_top
    scale = 280/source_height
    anchor_x = float(np.median(np.where(solid[round(body_top+source_height*.7):ey])[1]))
    ground_y = ey-1
    half_width = max(max(anchor_x-b[0], b[2]-anchor_x)*scale for b in extents)
    top_extent = max((ground_y-b[1])*scale for b in extents)
    foot_y = max(416, math.ceil((top_extent+32)/16)*16)
    bottom_extent = max((b[3]-ground_y)*scale for b in extents)
    cell = max(512, math.ceil(max(2*half_width+48, foot_y+bottom_extent+32)/64)*64)
    transform = {"scale": scale, "sourceAnchorX": anchor_x, "sourceGroundY": ground_y,
                 "frameWidth": cell, "frameHeight": cell, "anchorX": cell/2, "footY": foot_y,
                 "bodyHeightMetric": {"sourceBodyTop": body_top, "sourceBodyHeight": source_height, "targetBodyHeight": 280, "excludes": "thin upper elevator cage / protruding limbs"},
                 "policy": "One constant transform for all seven actions. Preserve source recoil, lift and collapse. No per-frame recentering or scaling; no purple/blue despill."}
    save(BUILD / "transform.json", transform)
    matrix = np.float32([[scale, 0, cell/2-anchor_x*scale], [0, scale, foot_y-ground_y*scale]])
    records = []
    for job in jobs():
        cells = []
        for rgba in sources[job["state"]]:
            # Premultiplied resampling prevents dark fringes on transparent edges.
            f = rgba.astype(np.float32)/255
            f[..., :3] *= f[..., 3:4]
            f = cv2.warpAffine(f, matrix, (cell, cell), flags=cv2.INTER_LANCZOS4)
            f = np.clip(f, 0, 1)
            f[..., :3] /= np.maximum(f[..., 3:4], 1e-6)
            out = np.clip(np.rint(f*255), 0, 255).astype(np.uint8)
            out[out[..., 3] == 0, :3] = 0
            x0, y0, x1, y1 = box(out)
            if min(x0, y0, cell-x1, cell-y1) < 16:
                raise RuntimeError(f"Unsafe output cell boundary: {job['state']}")
            cells.append(out)
        cols = 8
        sheet = np.zeros((math.ceil(len(cells)/cols)*cell, cols*cell, 4), np.uint8)
        for i, out in enumerate(cells):
            sheet[i//cols*cell:(i//cols+1)*cell, i%cols*cell:(i%cols+1)*cell] = out
        dest = BUILD / "source-sheets-pre-interpolation" / f"{job['state']}.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(sheet, "RGBA").save(dest)
        preview(cells, BUILD/"previews/source"/job["state"], 12)
        records.append({"state": job["state"], "label": job["label"], "sourceVideo": job["video"],
                        "sourceFrameIndices": indices(job), "sourceFrameRate": 24, "sourceSampleStep": 2,
                        "frameRate": 12, "frameCount": len(cells), "cols": cols,
                        "mode": "loop" if job["loop"] else "one-shot", "sheet": dest.relative_to(ROOT).as_posix(), "transform": transform})
        print(f"[source sheet] {job['state']} {len(cells)} x {cell}px", flush=True)
    save(BUILD/"source-manifest.json", {"runtimeIntegrationActive": False, "actions": records})


def interpolate():
    for rec in read(BUILD/"source-manifest.json")["actions"]:
        state = rec["state"]
        target = BUILD/"spritesheets"/f"{state}.png"
        report = BUILD/"reports/rife"/f"{state}.json"
        if target.exists() and report.exists():
            print(f"[RIFE cached] {state}", flush=True)
            continue
        cell = rec["transform"]["frameWidth"]
        count = rec["frameCount"]*2-int(rec["mode"] == "one-shot")
        cols = max(8, math.ceil(count/(8192//cell)))
        if cols*cell > 8192:
            raise RuntimeError("Texture size overflow")
        command = [sys.executable, str(TOOLS/"rife-spritesheet-interpolate.py"), "--sheet", str(ROOT/rec["sheet"]),
                   "--out", str(target), "--name", f"deep-vein-mother-{state}", "--frame-width", str(cell),
                   "--frame-height", str(cell), "--cols", str(rec["cols"]), "--frame-count", str(rec["frameCount"]),
                   "--frame-rate", "12", "--mode", rec["mode"], "--out-cols", str(cols),
                   "--preview-dir", str(BUILD/"previews/rife"), "--report", str(report),
                   "--repair-red-outliers", "--preserve-vertical-motion"]
        print(f"[RIFE begin] {state}", flush=True)
        subprocess.run(command, check=True)


def finish():
    actions, sequences = [], []
    for rec in read(BUILD/"source-manifest.json")["actions"]:
        state = rec["state"]
        report_path = BUILD/"reports/rife"/f"{state}.json"
        report = read(report_path)
        path = BUILD/"spritesheets"/f"{state}.png"
        sheet = np.asarray(Image.open(path).convert("RGBA"))
        count, cols, cell = report["outputFrameCount"], report["cols"], report["frameWidth"]
        cells = [sheet[i//cols*cell:(i//cols+1)*cell, i%cols*cell:(i%cols+1)*cell].copy() for i in range(count)]
        preview(cells, BUILD/"previews/final"/state, 24)
        checks = report["validation"]
        issues = [key for key in ("emptyFrames", "touchingFrames", "visibleDarkOutlierFrames", "visibleRedOutlierFrames", "middleFrameHeldSourceKeyFallbacks", "nonzeroRgbInTransparentPixels") if checks[key]]
        if not checks["originalKeyFramesPreservedAtEvenIndices"]:
            issues.append("originalKeyFramesChanged")
        row = {**rec, "sheet": path.relative_to(ROOT).as_posix(), "frameWidth": cell, "frameHeight": cell,
               "frameRate": 24, "frameCount": count, "cols": cols, "rows": report["rows"], "startFrame": 0, "endFrame": count-1,
               "durationSeconds": count/24, "repeat": -1 if rec["mode"] == "loop" else 0,
               "originalKeyOutputIndices": list(range(0, count, 2)), "origin": [0.5, rec["transform"]["footY"]/cell],
               "gif": (BUILD/"previews/final"/f"{state}.gif").relative_to(ROOT).as_posix(),
               "rifeReport": report_path.relative_to(ROOT).as_posix(), "pixelProductionReport": checks, "productionIssues": issues,
               "sourceApprovedByUser": True, "finalSpriteApprovedByUser": False, "runtimeIntegrationActive": False}
        if state == "dying":
            row.update(corpseFrame=count-1, holdLastFrameOnCompletion=True)
        actions.append(row)
        sequences.append((row, [checker(c).resize((288, 288), Image.Resampling.LANCZOS) for c in cells]))
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 19)
    small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
    count = max(row["frameCount"] for row in actions)
    boards = []
    for i in range(count):
        board = Image.new("RGB", (864, 3*344), "#20242a")
        draw = ImageDraw.Draw(board)
        for k, (row, frames) in enumerate(sequences):
            index = i%len(frames) if row["mode"] == "loop" else min(i, len(frames)-1)
            x, y = k%3*288, k//3*344
            board.paste(frames[index], (x, y+52))
            draw.text((x+9, y+5), row["label"], font=font, fill="white")
            draw.text((x+9, y+30), f"{row['frameCount']}帧 / {row['durationSeconds']:.2f}秒 / " + ("循环" if row["mode"] == "loop" else "单次"), font=small, fill="#bac6d2")
        boards.append(board)
    overview = BUILD/"previews/final/seven-actions-overview.gif"
    boards[0].save(overview, save_all=True, append_images=boards[1:], duration=timing(count, 24), loop=0, disposal=2, optimize=False)
    boards[0].save(overview.with_suffix(".png"))
    save(BUILD/"sprite-manifest.json", {"task": "deep-vein-mother-seven-approved-source-animations", "pipeline": "ComfyUI-RMBG BiRefNet-general + shared fixed transform + RIFE v4.6 RGB/Alpha 2x", "runtimeIntegrationActive": False,
         "gameTestsRun": False, "runtimeVerificationRun": False, "finalSpritesAwaitingUserReview": True,
         "previewPlaybackNote": "24 fps with distributed 10ms GIF rounding. Attacks and death are one-shot; the montage only repeats for review. Source natural motion and full duration preserved, except duplicate loop endpoint.",
         "overview": overview.relative_to(ROOT).as_posix(), "actions": actions})
    print(json.dumps([{k:r[k] for k in ("state", "frameCount", "durationSeconds", "productionIssues")} for r in actions], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("prepare", "cutouts", "compose", "interpolate", "finish"))
    args = parser.parse_args()
    globals()[args.stage]()
