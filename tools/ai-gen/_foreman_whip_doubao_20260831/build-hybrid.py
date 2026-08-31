"""Candidate: Doubao actor poses + a separate continuous, fixed-length whip.

This is explicitly a hybrid sprite, not an unmodified AI generation. Never
writes assets/enemies or gameplay configuration. RIFE runs on the actor only;
the thin whip is evaluated analytically at every output time to avoid ghosting.
"""
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
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
W, H, FOOT_X, FOOT_Y = 768, 384, 384, 336
SCALE = 268 / 213
SOURCE_ANCHOR = (522.5, 415)
# The old value FOOT_X is the working-canvas center, not the stance root.
# The first pose's support-band center is 35.5px left of it. A fixed 36px
# anchor correction preserves the old idle's 0.5px support-center residual.
STANCE_ANCHOR_X = FOOT_X - 36
DISPLAY_PIXEL_SCALE = 480 / 512
CONTACT_MS = 18 / 31 * 1500
FRAME_DURATIONS = [CONTACT_MS / 36] * 36 + [(1500 - CONTACT_MS) / 25] * 25
ANCHOR_INDICES = [0, 9, 18, 27, 33, 38, 42, 44, 47, 49, 53, 59, 66, 73, 80, 88]
INDICES = [value for i, value in enumerate(ANCHOR_INDICES) for value in ([value, round((value + ANCHOR_INDICES[i + 1]) / 2)] if i < 15 else [value])]
HANDS = [(574, 295), (472, 326), (421, 305), (431, 297), (413, 275), (416, 210), (468, 192), (588, 199), (637, 292), (633, 307), (627, 317), (623, 323), (620, 317), (618, 310), (615, 306), (613, 303)]
# Additional grips are read from the actual video poses, not inferred from a
# straight path between the sixteen broad motion anchors.
MID_HANDS = [(548, 321), (412, 316), (433, 305), (419, 286), (407, 234), (436, 203), (516, 194), (631, 276), (635, 305), (630, 318), (619, 326), (624, 324), (619, 318), (613, 307), (611, 303)]
FINAL_HANDS = {i * 4: hand for i, hand in enumerate(HANDS)}
FINAL_HANDS.update({i * 4 + 2: hand for i, hand in enumerate(MID_HANDS)})
# The five visibly warped intermediate poses use original source frames.
# Adjacent original poses 42/43 and 43/44 have no distinct integer midpoint;
# the nearest intact key is held for one 24.6ms slot instead of ghost blending.
BODY_SOURCE_FALLBACKS = {3: 6, 23: 41, 25: 42, 27: 44, 29: 45}
FINAL_HANDS.update({3: (521, 330), 23: (446, 192), 25: HANDS[6], 27: HANDS[7], 29: (620, 236)})
CURVES = [
    [(0, 0), (.35, .03), (.8, .35), (.9, .6)],
    [(0, 0), (-.5, .1), (-.8, .55), (-.2, .55)],
    [(0, 0), (-.45, .05), (-.7, .65), (.1, .85)],
    [(0, 0), (-.6, .05), (-.9, .45), (-.4, .8)],
    [(0, 0), (-.1, .2), (-.3, .7), (-.8, .85)],
    [(0, 0), (-.25, .35), (-.05, .8), (-.4, 1)],
    [(0, 0), (-.7, -.03), (-1, .5), (-.8, .9)],
    [(0, 0), (-.3, -.16), (-.8, -.25), (-1, .08)],
    [(0, 0), (.6, -.2), (.75, -.65), (-.2, -.9)],
    [(0, 0), (.33, 0), (.66, 0), (1, 0)],
    [(0, 0), (.33, .08), (.7, -.15), (1, -.05)],
    [(0, 0), (.3, .15), (.8, .18), (.95, -.15)],
    [(0, 0), (.3, .1), (.9, .2), (.85, -.35)],
    [(0, 0), (.35, .15), (.85, .2), (.85, -.05)],
    [(0, 0), (.4, .1), (.6, .65), (.8, .7)],
    [(0, 0), (.4, .12), (.55, .6), (.7, .78)],
]
# Match the existing 320px ground reach from the corrected stance root, not
# from the transparent canvas center. Body pixels are never rescaled here.
WHIP_LENGTH = (320 / DISPLAY_PIXEL_SCALE - (FOOT_X - STANCE_ANCHOR_X)) / SCALE - (HANDS[9][0] - SOURCE_ANCHOR[0])
TRANSFORM = np.float32([[SCALE, 0, FOOT_X - SOURCE_ANCHOR[0] * SCALE], [0, SCALE, FOOT_Y - SOURCE_ANCHOR[1] * SCALE]])


def transform_rgba(rgba):
    premul = rgba.astype(np.float32)
    premul[..., :3] *= premul[..., 3:4] / 255
    result = cv2.warpAffine(premul, TRANSFORM, (W, H), flags=cv2.INTER_LANCZOS4)
    alpha = np.clip(result[..., 3:4], 0, 255)
    result[..., :3] = np.clip(result[..., :3] * 255 / np.maximum(alpha, 1), 0, 255)
    result[..., 3:4] = alpha
    result[alpha[..., 0] < 3] = 0
    return result.astype(np.uint8)


def actor_only(rgba, source_index):
    alpha = rgba[..., 3]
    core = cv2.morphologyEx((alpha > 80).astype(np.uint8), cv2.MORPH_OPEN, np.ones((11, 11), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(core, 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    body = (labels == largest).astype(np.uint8)
    protect = cv2.dilate(body, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0
    # The rope can touch the soles. In the lowest body band use a thicker
    # body core to avoid treating that narrow horizontal rope as an extra foot.
    body_y, _ = np.where(body)
    foot_core = cv2.morphologyEx((alpha > 80).astype(np.uint8), cv2.MORPH_OPEN, np.ones((17, 17), np.uint8))
    foot_protect = cv2.dilate(foot_core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))) > 0
    protect[max(0, int(body_y.max()) - 24):] &= foot_protect[max(0, int(body_y.max()) - 24):]
    clean = rgba.copy()
    clean[~protect] = 0
    if source_index == 18:
        # In this one pose the old AI rope touches the ground beside the front
        # toes. Preserve both feet; discard only the separately inspected rope
        # strip to their right (the rear foot ends above this narrow strip).
        clean[410:, 523:] = 0
    # Remove edge matte contamination without changing the opaque actor.
    solid = clean[..., 3] >= 245
    _, nearest = distance_transform_edt(~solid, return_indices=True)
    semi = (clean[..., 3] > 0) & (clean[..., 3] < 245)
    clean[semi, :3] = clean[nearest[0][semi], nearest[1][semi], :3]
    return clean


def whip_points(position):
    left = min(14, int(position))
    amount = position - left
    if position >= 15:
        left, amount = 14, 1
    hand_keys = sorted(FINAL_HANDS)
    hand = np.array([np.interp(position * 4, hand_keys, [FINAL_HANDS[key][axis] for key in hand_keys]) for axis in (0, 1)])
    control = np.array(CURVES[left]) * (1 - amount) + np.array(CURVES[left + 1]) * amount
    t = np.linspace(0, 1, 160)[:, None]
    curve = (1 - t) ** 3 * control[0] + 3 * (1 - t) ** 2 * t * control[1] + 3 * (1 - t) * t ** 2 * control[2] + t ** 3 * control[3]
    length = np.linalg.norm(np.diff(curve, axis=0), axis=1).sum()
    curve = curve * WHIP_LENGTH / length + hand
    curve[:, 0] = (curve[:, 0] - SOURCE_ANCHOR[0]) * SCALE + FOOT_X
    curve[:, 1] = (curve[:, 1] - SOURCE_ANCHOR[1]) * SCALE + FOOT_Y
    return curve


def whip_image(position):
    points = whip_points(position)
    layer = Image.new("RGBA", (W * 3, H * 3))
    draw = ImageDraw.Draw(layer)
    for color, thickness in (((49, 28, 18, 255), 3.4), ((119, 77, 42, 255), 1.5)):
        for index, (a, b) in enumerate(zip(points, points[1:])):
            taper = 1 - .7 * index / (len(points) - 1)
            draw.line((tuple(a * 3), tuple(b * 3)), fill=color, width=max(1, round(thickness * SCALE * taper * 3)))
    return layer.resize((W, H), Image.Resampling.LANCZOS)


def checker(image):
    rgba = np.array(image)
    yy, xx = np.indices(rgba.shape[:2])
    bg = np.where(((xx // 20 + yy // 20) % 2)[..., None], 66, 82)
    alpha = rgba[..., 3:4] / 255
    return Image.fromarray(np.clip(rgba[..., :3] * alpha + bg * (1 - alpha), 0, 255).astype(np.uint8))


def save_gif(frames, target):
    source_durations = FRAME_DURATIONS if len(frames) == 61 else [1500 / len(frames)] * len(frames)
    cumulative = np.concatenate(([0], np.cumsum(source_durations)))
    durations = [10 * (round(cumulative[i + 1] / 10) - round(cumulative[i] / 10)) for i in range(len(frames))]
    frames[0].save(target, save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--finalize", action="store_true")
    args = parser.parse_args()
    if not args.finalize:
        sheet = Image.new("RGBA", (4 * W, 8 * H))
        previews = []
        model, video_frames = None, None
        for i, source_index in enumerate(INDICES):
            cached = ROOT / f"source-inputs/whip-v04-optimized/{source_index:04d}.png"
            if not cached.exists():
                if model is None:
                    sys.path.insert(0, str(ROOT.parent))
                    from rmbg_cutout import get_model
                    model = get_model()
                    spec = importlib.util.spec_from_file_location("candidate_cutout", ROOT / "build-candidate.py")
                    cutout_module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(cutout_module)
                    with av.open(str(ROOT / "videos/whip-v04.mp4")) as container:
                        video_frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
                print(f"BiRefNet additional source frame {source_index}", flush=True)
                Image.fromarray(cutout_module.cutout(video_frames[source_index], model)).save(cached)
            raw = np.asarray(Image.open(cached).convert("RGBA"))
            actor = Image.fromarray(transform_rgba(actor_only(raw, source_index)))
            sheet.paste(actor, (i % 4 * W, i // 4 * H))
            layer = whip_image(i / 2)
            layer.alpha_composite(actor)
            previews.append(checker(layer))
        sheet.save(ROOT / "sheets/hybrid-body-base.png")
        save_gif(previews, ROOT / "previews/hybrid-keyframes-1500ms.gif")
        contact = Image.new("RGB", (4 * 384, 8 * 214), "#20262d")
        draw = ImageDraw.Draw(contact)
        for i, preview in enumerate(previews):
            x, y = i % 4 * 384, i // 4 * 214
            contact.paste(preview.resize((384, 192)), (x, y))
            draw.text((x + 4, y + 196), f"key {i} / source {INDICES[i]}", fill="white")
        contact.save(ROOT / "previews/hybrid-keyframes-contact.png")
        print("Prepared 31 actor-only keys, a continuous fixed-length whip layer and hybrid preview.")
        return
    actor_sheet = Image.open(ROOT / "sheets/hybrid-body-rife.png").convert("RGBA")
    full_frames, boxes = [], []
    for i in range(61):
        actor = actor_sheet.crop((i % 6 * W, i // 6 * H, i % 6 * W + W, i // 6 * H + H))
        if i in BODY_SOURCE_FALLBACKS:
            source_index = BODY_SOURCE_FALLBACKS[i]
            source = np.asarray(Image.open(ROOT / f"source-inputs/whip-v04-optimized/{source_index:04d}.png").convert("RGBA"))
            actor = Image.fromarray(transform_rgba(actor_only(source, source_index)))
        image = whip_image(i / 4)
        image.alpha_composite(actor)
        box = image.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
        full_frames.append(image)
        boxes.append(box)
    half = math.ceil((max(max(FOOT_X - box[0], box[2] - FOOT_X) for box in boxes) + 8) / 8) * 8
    top = math.floor((min(box[1] for box in boxes) - 8) / 8) * 8
    bottom = math.ceil((max(box[3] for box in boxes) + 8) / 8) * 8
    crop = (FOOT_X - half, top, FOOT_X + half, bottom)
    fw, fh = half * 2, bottom - top
    frames = [image.crop(crop) for image in full_frames]
    final = Image.new("RGBA", (6 * fw, 11 * fh))
    previews, margins = [], []
    for i, image in enumerate(frames):
        final.paste(image, (i % 6 * fw, i // 6 * fh))
        previews.append(checker(image))
        box = image.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
        margins.append(min(box[0], box[1], fw - box[2], fh - box[3]))
    if min(margins) < 8:
        raise ValueError(f"Insufficient final frame safety margin: {margins}")
    if max(final.size) > 4096:
        raise ValueError(f"Final texture exceeds the candidate's 4096px limit: {final.size}")
    final.save(ROOT / "sheets/foreman-whip-hybrid-candidate.png")
    save_gif(previews, ROOT / "previews/foreman-whip-hybrid-1500ms.gif")
    contact = Image.new("RGB", (4 * 384, 5 * 214), "#20262d")
    draw = ImageDraw.Draw(contact)
    for n, i in enumerate(np.rint(np.linspace(0, 60, 20)).astype(int)):
        x, y = n % 4 * 384, n // 4 * 214
        thumb = ImageOps.contain(previews[i], (384, 192), Image.Resampling.LANCZOS)
        contact.paste(thumb, (x + (384 - thumb.width) // 2, y))
        draw.text((x + 4, y + 196), f"f{i:02d} / {sum(FRAME_DURATIONS[:i]):.0f}ms", fill="white")
    contact.save(ROOT / "previews/foreman-whip-hybrid-contact.png")
    tip = whip_points(9)[-1]
    manifest = {
        "status": "hybrid review candidate; NOT installed in game",
        "sourceVideo": "videos/whip-v04.mp4", "provider": "Doubao Seedance 2.0 Mini",
        "sourceIndices": INDICES, "whipAnchorSourceIndices": ANCHOR_INDICES, "bodyProcessing": "BiRefNet actor isolation, one fixed affine transform, RIFE v4.6 2x one-shot",
        "whipProcessing": "Independent tapered cubic curve, fixed arc length, continuous control interpolation; explicitly not the raw AI whip",
        "handSourceCoordinates": HANDS, "outputFrameHandAnchors": FINAL_HANDS, "controlCurves": CURVES, "whipLengthSourcePx": WHIP_LENGTH,
        "bodySourceFallbacks": BODY_SOURCE_FALLBACKS, "bodySourceFallbackReason": "Five visually warped RIFE intermediates replaced with original source poses; 25 and 27 hold the nearest intact key for one slot.",
        "sourceBodyHeight": 213, "fixedActorScale": SCALE, "neutralBodyHeight": 268,
        "referenceCell": 512, "existingDisplaySize": 480, "worldBodyHeightAtZoom1": 251.25,
        "frameWidth": fw, "frameHeight": fh, "frameCount": 61, "endFrame": 60, "cols": 6, "rows": 11,
        "commonCrop": crop, "footX": STANCE_ANCHOR_X - crop[0], "footY": FOOT_Y - top,
        "canvasCenterX": half, "stanceAnchorCorrectionPx": -36,
        "durationMs": 1500, "frameRate": 61 / 1.5, "frameDurations": FRAME_DURATIONS, "repeat": 0,
        "contactPoseFrame": 36, "contactPoseMs": sum(FRAME_DURATIONS[:36]),
        "soundFrame": 30, "soundMs": sum(FRAME_DURATIONS[:30]),
        "existingGameplayHitMs": 18 / 31 * 1500, "existingGameplaySoundMs": 15 / 31 * 1500,
        "sideViewContactTipReachWorldPx": float((tip[0] - STANCE_ANCHOR_X) * DISPLAY_PIXEL_SCALE),
        "minimumVisibleFrameMarginPx": min(margins), "sheetSize": list(final.size),
        "rgbaMiB": final.width * final.height * 4 / 1048576,
        "artifactRole": "baked side-view reference only; not the installed runtime sheet",
        "runtimeDeliveryManifest": "runtime-manifest.json",
        "knownLimits": ["This reference has no idle transition and only depicts left/right attacks.", "The installed body sheet, idle crossfade and independent directional whip are documented in runtime-manifest.json.", "No runtime validation performed; offline reference images do not prove game behavior."]
    }
    (ROOT / "hybrid-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest), flush=True)


if __name__ == "__main__":
    main()
