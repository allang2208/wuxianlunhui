"""BiRefNet cutouts and one fixed transform; never writes runtime assets."""
from pathlib import Path
import argparse
import json
import math
import sys
import importlib.util
import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))


def bounds(mask):
    y, x = np.where(mask)
    if not len(x):
        raise ValueError("Empty character mask")
    return [int(x.min()), int(y.min()), int(x.max()) + 1, int(y.max()) + 1]


def body_bounds(alpha):
    mask = (alpha > 64).astype(np.uint8)
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return bounds(labels == largest)


def cutout(rgb, model):
    from rmbg_cutout import predict_alpha
    alpha = np.squeeze(predict_alpha(model, Image.fromarray(rgb))).astype(np.float32)
    if alpha.max() <= 1.5:
        alpha *= 255
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]))
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    alpha[alpha < 6] = 0
    # Keep the entire predicted whip, including its far tip. A body-relative
    # ROI would silently crop the exact long weapon this task is preserving.
    color = rgb.astype(np.float32)
    a = alpha.astype(np.float32) / 255
    semi = (a > .02) & (a < .98)
    # White/near-white compositing matte only; do not recolor solid foreground.
    background = np.median(np.concatenate((rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3))), axis=0)
    color[semi] = np.clip((color[semi] - (1 - a[semi, None]) * background) / a[semi, None], 0, 255)
    color[alpha == 0] = 0
    return np.dstack((color.astype(np.uint8), alpha))


def checker(frame):
    yy, xx = np.indices(frame.shape[:2])
    bg = np.where(((xx // 16 + yy // 16) % 2)[..., None], 64, 82)
    a = frame[..., 3:4].astype(np.float32) / 255
    return Image.fromarray(np.clip(frame[..., :3] * a + bg * (1 - a), 0, 255).astype(np.uint8))


def save_gif(images, path, duration_ms):
    durations = [10 * (round((i + 1) * duration_ms / len(images) / 10) - round(i * duration_ms / len(images) / 10)) for i in range(len(images))]
    images[0].save(path, save_all=True, append_images=images[1:], duration=durations, loop=0, disposal=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--indices", required=True)
    parser.add_argument("--label", default="whip-v02")
    parser.add_argument("--impact-source-frame", type=int, required=True)
    parser.add_argument("--normalize-whip", action="store_true")
    parser.add_argument("--finalize", action="store_true")
    args = parser.parse_args()
    manifest_path = HERE / f"{args.label}-manifest.json"
    if args.finalize:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        image = Image.open(HERE / f"sheets/{args.label}-rife.png").convert("RGBA")
        w, h, cols, count = [manifest[key] for key in ("frameWidth", "frameHeight", "finalCols", "finalFrameCount")]
        cells = [np.asarray(image.crop((i % cols * w, i // cols * h, i % cols * w + w, i // cols * h + h))) for i in range(count)]
        pictures = [checker(cell) for cell in cells]
        save_gif(pictures, HERE / f"previews/{args.label}-attack-1500ms.gif", 1500)
        selected = np.rint(np.linspace(0, count - 1, 20)).astype(int)
        contact = Image.new("RGB", (4 * 384, 5 * 244), "#20262d")
        draw = ImageDraw.Draw(contact)
        for n, i in enumerate(selected):
            x, y = n % 4 * 384, n // 4 * 244
            thumb = ImageOps.contain(pictures[i], (384, 216))
            contact.paste(thumb, (x + (384 - thumb.width) // 2, y + (216 - thumb.height) // 2))
            draw.text((x + 5, y + 221), f"f{i:02d} / {i * 1500 / count:.0f}ms", fill="white")
        contact.save(HERE / f"previews/{args.label}-final-contact.png")
        manifest["finalSheet"] = {"size": list(image.size), "rgbaMiB": image.width * image.height * 4 / 1048576}
        manifest["finalBounds"] = [bounds(cell[..., 3] > 16) for cell in cells]
        manifest["previewDurationMs"] = 1500
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(json.dumps({"preview": str(HERE / f"previews/{args.label}-attack-1500ms.gif"), "sheet": manifest["finalSheet"]}))
        return
    indices = [int(value) for value in args.indices.split(",")]
    with av.open(str(args.video)) as container:
        fps = float(container.streams.video[0].average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
    cache = HERE / f"cutout-cache/{args.label}"
    cache.mkdir(parents=True, exist_ok=True)
    model = None
    cutouts = []
    for index in indices:
        cached = cache / f"{index:04d}.png"
        if cached.exists():
            cut = np.asarray(Image.open(cached).convert("RGBA"))
        else:
            if model is None:
                from rmbg_cutout import get_model
                model = get_model()
            print(f"BiRefNet source frame {index}", flush=True)
            cut = cutout(frames[index], model)
            Image.fromarray(cut).save(cached)
        cutouts.append(cut)
    reference = body_bounds(cutouts[0][..., 3])
    weapon_records = []
    if args.normalize_whip:
        spec = importlib.util.spec_from_file_location("whip_length", HERE / "whip-length.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        fixed = []
        for index, cut in zip(indices, cutouts):
            result, record = module.normalize_whip(cut, reference[3] - reference[1])
            fixed.append(result)
            weapon_records.append({"sourceFrame": index, **record})
        cutouts = fixed
    scale = 268 / (reference[3] - reference[1])
    source_anchor = [(reference[0] + reference[2]) / 2, reference[3]]
    transform = np.float32([[scale, 0, 768 - scale * source_anchor[0]], [0, scale, 600 - scale * source_anchor[1]]])
    cells = []
    for cut in cutouts:
        color = cut.astype(np.float32)
        color[..., :3] *= color[..., 3:4] / 255
        transformed = cv2.warpAffine(color, transform, (1536, 1024), flags=cv2.INTER_LANCZOS4)
        alpha = np.clip(transformed[..., 3:4], 0, 255)
        transformed[..., :3] = np.clip(transformed[..., :3] * 255 / np.maximum(alpha, 1), 0, 255)
        transformed[..., 3:4] = alpha
        transformed[alpha[..., 0] < 3] = 0
        cells.append(transformed.astype(np.uint8))
    boxes = [bounds(cell[..., 3] > 2) for cell in cells]
    half_width = math.ceil((max(768 - b[0] for b in boxes) + 8) / 8) * 8
    half_width = max(half_width, math.ceil((max(b[2] - 768 for b in boxes) + 8) / 8) * 8)
    top = math.floor((min(b[1] for b in boxes) - 8) / 8) * 8
    bottom = math.ceil((max(b[3] for b in boxes) + 8) / 8) * 8
    cells = [cell[top:bottom, 768 - half_width:768 + half_width] for cell in cells]
    w, h = half_width * 2, bottom - top
    final_count = len(cells) * 2 - 1
    layouts = [(col, math.ceil(final_count / col)) for col in range(1, 4096 // w + 1) if math.ceil(final_count / col) * h <= 4096]
    if not layouts:
        raise ValueError(f"Candidate needs a new layout decision: {final_count} frames of {w}x{h} exceed 4096px")
    cols, rows = min(layouts, key=lambda pair: (pair[0] * pair[1], abs(pair[0] * w - pair[1] * h)))
    base_cols = min(cols, len(cells))
    sheet = Image.new("RGBA", (w * base_cols, h * math.ceil(len(cells) / base_cols)))
    for i, cell in enumerate(cells):
        sheet.paste(Image.fromarray(cell), (i % base_cols * w, i // base_cols * h))
    sheet.save(HERE / f"sheets/{args.label}-base.png")
    save_gif([checker(cell) for cell in cells], HERE / f"previews/{args.label}-keyframes-1500ms.gif", 1500)
    manifest = {
        "status": "candidate-only; not installed", "provider": "doubao-desktop", "sourceVideo": str(args.video),
        "sourceFps": fps, "sourceIndices": indices, "sourceImpactFrame": args.impact_source_frame,
        "sourceNeutralBodyBBox": reference, "sourceAnchor": source_anchor, "fixedScale": scale,
        "neutralBodyHeight": 268, "referenceCell": 512, "existingDisplaySize": 480,
        "existingBodyWorldHeight": 268 * 480 / 512, "frameWidth": w, "frameHeight": h,
        "footX": half_width, "footY": 600 - top, "baseCols": base_cols, "baseFrameCount": len(cells),
        "finalCols": cols, "finalRows": rows, "finalFrameCount": final_count, "durationMs": 1500,
        "finalFrameRate": final_count / 1.5, "rifeInputFrameRate": final_count / 3,
        "plannedRgbaMiB": w * h * cols * rows * 4 / 1048576,
        "whipLengthConstraint": weapon_records,
        "notes": ["One fixed whole-character transform; no per-frame actor centering or scaling.", "Optional weapon-only length correction is listed separately for every source key.", "Whip only affects common crop, not body scale.", "Existing 1500ms duration used for final GIF; no runtime changes.", "Raw candidates and original keyframes remain archived."]
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest), flush=True)


if __name__ == "__main__":
    main()
