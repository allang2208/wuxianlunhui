"""Remove H3's extra tail tip from this one video preview, preserving source motion."""

import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "videos/carry-walking-h3-v01.mp4"
PREVIEWS = ROOT / "previews"
# Recalibrated for this new side-facing source; see previews/carry-tail-roi-f11.png.
ROI = (345, 360, 440, 435)
SAMPLES = [0, 11, 22, 34, 45, 56, 67, 78, 89, 101, 112, 123]
COMPARE = [11, 45, 78, 112]


def clean_tail(rgb):
    foreground = (rgb.min(axis=2) < 235).astype(np.uint8)
    core = cv2.morphologyEx(
        foreground, cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)),
    )
    protected = cv2.dilate(
        core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    ).astype(bool)
    r, g, b = rgb.astype(np.float32).transpose(2, 0, 1)
    warm_light = (r > 125) & (g > 85) & (r > g * 1.12) & (g > b * 1.12)
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    warm_light &= luminance > 105
    protected |= (luminance < 100) & foreground.astype(bool)
    region = np.zeros(foreground.shape, dtype=bool)
    x0, y0, x1, y1 = ROI
    region[y0:y1, x0:x1] = True
    tip = foreground.astype(bool) & ~protected & warm_light & region
    mask = cv2.dilate(
        tip.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)),
    ).astype(bool) & ~protected & region
    result = rgb.copy()
    # The source's nominal white backdrop is slightly off-white. Copy its same-row
    # empty left strip, rather than leaving a visible pure-white tail silhouette.
    background_rows = np.median(rgb[:, 300:325, :], axis=1).astype(np.uint8)
    background = np.broadcast_to(background_rows[:, None, :], rgb.shape)
    result[mask] = background[mask]
    # Clear tiny tip remnants detached by the removal, confined to its vicinity.
    remaining = (result.min(axis=2) < 235).astype(np.uint8)
    _, components, stats, _ = cv2.connectedComponentsWithStats(remaining, 8)
    nearby = cv2.dilate(mask.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    orphan = np.zeros_like(region)
    for label in range(1, len(stats)):
        if stats[label, cv2.CC_STAT_AREA] <= 64:
            piece = components == label
            if np.any(piece & nearby & region):
                orphan |= piece & region
    orphan = cv2.dilate(orphan.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    mask |= orphan & nearby & region & ~protected
    # The component itself is detached from all clothing, including dark tip pixels.
    mask |= orphan & nearby & region & (components > 0) & (stats[components, cv2.CC_STAT_AREA] <= 64)
    result[mask] = background[mask]
    return result, mask


def main():
    with av.open(str(SOURCE)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = []
        cleaned_samples = {}
        comparison = Image.new("RGB", (960, len(COMPARE) * 292), "#202020")
        labels = ImageDraw.Draw(comparison)
        counts = []
        for index, frame in enumerate(container.decode(stream)):
            rgb = frame.to_ndarray(format="rgb24")
            cleaned, mask = clean_tail(rgb)
            counts.append(int(mask.sum()))
            image = Image.fromarray(cleaned)
            frames.append(image.resize((768, 432), Image.Resampling.LANCZOS))
            if index in COMPARE:
                row = COMPARE.index(index)
                marked = rgb.copy()
                marked[mask] = [255, 0, 0]
                for column, pixels in enumerate((rgb, marked, cleaned)):
                    crop = Image.fromarray(pixels).crop((325, 315, 485, 450))
                    crop = crop.resize((320, 270), Image.Resampling.NEAREST)
                    comparison.paste(crop, (column * 320, row * 292))
                labels.text((4, row * 292 + 274), f"frame {index}: original / removed pixels / cleaned", fill="white")
            if index in SAMPLES:
                cleaned_samples[index] = image

    ticks = [round(i / fps * 100) for i in range(len(frames) + 1)]
    durations = [(ticks[i + 1] - ticks[i]) * 10 for i in range(len(frames))]
    output = PREVIEWS / "carry-walking-h3-v01-tail-clean.gif"
    frames[0].save(output, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, disposal=2, optimize=False)
    comparison.save(PREVIEWS / "carry-tail-cleanup-comparison.png")
    contact = Image.new("RGB", (1400, 1116), "#202020")
    labels = ImageDraw.Draw(contact)
    for cell, index in enumerate(SAMPLES):
        crop = cleaned_samples[index].crop((280, 32, 792, 544)).resize((350, 350), Image.Resampling.LANCZOS)
        x, y = cell % 4 * 350, cell // 4 * 372
        contact.paste(crop, (x, y))
        labels.text((x + 8, y + 354), f"source frame {index}", fill="white")
    contact.save(PREVIEWS / "carry-walking-h3-v01-tail-clean-contact.png")
    report = {
        "sourceVideo": str(SOURCE), "outputPreview": str(output),
        "scope": "Extra warm tail-tip pixels outside the coarse protected body, inside the rear-hip ROI only; short thick root may remain.",
        "roi": list(ROI), "openingKernel": 31, "protectionDilation": 5,
        "tailFringeDilation": 9, "darkEquipmentProtectionLuminance": 100,
        "detachedTipMaximumComponentPixels": 64,
        "removedPixelsPerFrame": counts, "removedPixelsTotal": sum(counts),
        "sourceFrames": len(frames), "sourceFps": fps, "previewDurationMs": sum(durations),
        "sourceVideoModified": False, "motionOrScaleChanged": False,
        "sourceFramesDropped": False, "transparentSpritesheetCreated": False,
        "backgroundFill": "Same-row median RGB from source columns 300:325 (empty backdrop strip)",
        "note": "Cleaned GIF is a locally corrected derivative, not the unmodified H3 video."
    }
    (PREVIEWS / "carry-tail-cleanup.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {output}; tail pixels removed={sum(counts)}, max/frame={max(counts)}")


if __name__ == "__main__":
    main()
