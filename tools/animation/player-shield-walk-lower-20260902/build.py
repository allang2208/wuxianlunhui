"""Publish the continuous native walking core and preview the restored shield rig.

The cleaned pelvis/leg source is retained from the first shield-walk pass. The
published body combines it with head, chest and lumbar pixels from the same
native walking frame. It does not redraw anatomy or borrow gun assets.
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FRAME = (512, 516)
BODY_FRAME = (516, 516)
PREVIEW_FRAME = (768, 640)
PREVIEW_OFFSET_X = 64
PREVIEW_OFFSET_Y = 120
PREVIEW_OUTPUT = (384, 320)
COLS = 8
FRAME_COUNT = 21

SOURCE_ARCHIVE = HERE / "source-original-walk-lower.png"
WALK_SOURCE = ROOT / "assets/character/walk.png"
RUNTIME_BODY = ROOT / "assets/player/shield_walk_body.png"
IDLE = ROOT / "assets/player/idle.png"
EQUIPMENT_CONFIG = ROOT / "data/equipment.json"
SHIELD_WEAPON_ID = "weapon17"
RED_SHIELD_WEAPON_ID = "weapon57"
PREVIEW_HANDS = HERE / "shield-walk-restored-hands-no-equipment.gif"
PREVIEW_GUARD = HERE / "shield-walk-small-round-perspective-standard.gif"
PREVIEW_RED_GUARD = HERE / "shield-walk-oak-garrison-corrected.gif"
PREVIEW_STAND_GUARD = HERE / "shield-standing-small-round-perspective-standard.png"
PREVIEW_RED_STAND_GUARD = HERE / "shield-standing-oak-garrison-corrected.png"
PREVIEW_ALL_STANDING = HERE / "shield-all-standing-guard.png"
CONTACT = HERE / "shield-walk-small-round-perspective-contact.png"
REPORT = HERE / "build-report.json"

MAIN_POLYGONS = [
    [(209, 96), (226, 96), (220, 140), (210, 188), (195, 193), (192, 180), (205, 129)],
    [(193, 176), (211, 176), (212, 240), (210, 252), (196, 261), (191, 254), (193, 214)],
    [(195, 251), (210, 245), (226, 267), (225, 289), (196, 289)],
]
OFF_UPPER = [(290, 97), (314, 97), (320, 184), (300, 184), (293, 139)]
OFF_FOREARM = [(300, 178), (320, 178), (340, 244), (340, 290), (310, 290), (307, 239), (300, 195)]
OFF_HAND = [(312, 238), (342, 238), (342, 292), (308, 292)]
OFF_SHOULDER = (301, 106)
OFF_ELBOW = (310, 185)
OFF_GRIP = (327, 268)
BASELINE_GUARD_UPPER_DEGREES = -12
BASELINE_GUARD_FOREARM_DEGREES = -110
PREVIOUS_GUARD_UPPER_DEGREES = 6
PREVIOUS_GUARD_FOREARM_DEGREES = -122
GUARD_UPPER_DEGREES = 8
GUARD_FOREARM_DEGREES = -132
STAND_GUARD_UPPER_DEGREES = 8
STAND_GUARD_FOREARM_DEGREES = -132
WALK_GUARD_TILT = -0.14
GUARD_SHIELD_DEGREES = math.degrees(WALK_GUARD_TILT)
MAIN_SHOULDER = (217, 105)

# 逐帧取自原生 walking 肩关节圆心；只决定独立手臂的挂点和躯干保留带，
# 不参与改造腰、骨盆或腿部像素。
WALK_MAIN_SHOULDERS = [
    (227, 115), (228, 114), (224, 112), (223, 113), (224, 113), (221, 114), (227, 114),
    (229, 116), (234, 115), (242, 117), (237, 110), (239, 111), (240, 109), (241, 106),
    (240, 106), (239, 103), (237, 104), (236, 110), (235, 113), (231, 119), (228, 117),
]
WALK_OFF_SHOULDERS = [
    (313, 110), (312, 108), (305, 107), (303, 108), (302, 109), (294, 116), (299, 119),
    (301, 122), (305, 124), (313, 130), (317, 119), (319, 119), (319, 119), (322, 117),
    (323, 116), (323, 113), (322, 111), (322, 116), (321, 116), (319, 117), (315, 112),
]


def sheet_frame(sheet, index):
    x, y = index % COLS * FRAME[0], index // COLS * FRAME[1]
    return sheet.crop((x, y, x + FRAME[0], y + FRAME[1]))


def polygon_mask(size, polygons):
    mask = Image.new("L", size)
    draw = ImageDraw.Draw(mask)
    for polygon in polygons:
        draw.polygon(polygon, fill=255)
    return mask


def polygon_part(source, polygons):
    result = source.copy()
    mask = polygon_mask(source.size, polygons)
    result.putalpha(ImageChops.multiply(source.getchannel("A"), mask))
    return result


def turn(point, pivot, root, degrees):
    cosine, sine = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    x, y = point[0] - pivot[0], point[1] - pivot[1]
    return root[0] + cosine * x - sine * y, root[1] + sine * x + cosine * y


def guard_grip_offset(upper_degrees, forearm_degrees):
    elbow = turn(OFF_ELBOW, OFF_SHOULDER, OFF_SHOULDER, upper_degrees)
    grip = turn(OFF_GRIP, OFF_ELBOW, elbow, forearm_degrees)
    return grip[0] - OFF_SHOULDER[0], grip[1] - OFF_SHOULDER[1]


def place(image, pivot, root, degrees, size=BODY_FRAME):
    cosine, sine = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return image.transform(size, Image.Transform.AFFINE, (
        cosine, sine, pivot[0] - cosine * root[0] - sine * root[1],
        -sine, cosine, pivot[1] + sine * root[0] - cosine * root[1],
    ), Image.Resampling.BICUBIC)


def load_reviewed_lower():
    if not SOURCE_ARCHIVE.exists():
        raise FileNotFoundError("reviewed pre-component lower sheet is missing")
    sheet = Image.open(SOURCE_ARCHIVE).convert("RGBA")
    expected = (COLS * FRAME[0], math.ceil(FRAME_COUNT / COLS) * FRAME[1])
    if sheet.size != expected:
        raise ValueError(f"lower sheet must be {expected}, got {sheet.size}")
    return sheet


def load_all_shield_preview_configs():
    """Read every shield's formal runtime image, grip and display ratios from config."""
    payload = json.loads(EQUIPMENT_CONFIG.read_text(encoding="utf-8"))
    configs = []
    for item in payload.get("equipment", {}).values():
        if item.get("type") != "盾":
            continue
        visual = item.get("shieldVisual") or {}
        required = (
            "originX", "originY", "defenseOriginX", "defenseOriginY", "visibleHeightRatio",
            "bodyHeightRatio", "defensePerspectiveScaleX",
        )
        if any(key not in visual for key in required):
            raise ValueError(f"{item.get('weaponId')} is missing formal shieldVisual fields")
        configs.append(({
            "weaponId": item["weaponId"],
            **{key: float(visual[key]) for key in required},
        }, ROOT / (visual.get("guardImage") or item["equipImage"])))
    if not configs:
        raise ValueError(f"no shields found in {EQUIPMENT_CONFIG}")
    return configs


def load_shield_preview_config(weapon_id=SHIELD_WEAPON_ID):
    for visual, path in load_all_shield_preview_configs():
        if visual["weaponId"] == weapon_id:
            return visual, path
    raise ValueError(f"{weapon_id} not found in {EQUIPMENT_CONFIG}")


def prepare_shield(shield_visual, shield_path):
    shield = Image.open(shield_path).convert("RGBA")
    display_height = round(
        FRAME[0] * shield_visual["bodyHeightRatio"] / shield_visual["visibleHeightRatio"]
    )
    display_width = round(
        display_height * shield.width / shield.height
        * shield_visual["defensePerspectiveScaleX"]
    )
    shield = shield.resize((display_width, display_height), Image.Resampling.LANCZOS)
    pivot = (
        shield.width * shield_visual.get("defenseOriginX", shield_visual["originX"]),
        shield.height * shield_visual["defenseOriginY"],
    )
    return shield, pivot


def build_native_body(lower_sheet):
    """Keep the native per-frame head/chest/lumbar and the cleaned native pelvis/legs."""
    walking = Image.open(WALK_SOURCE).convert("RGBA")
    body_sheet = Image.new("RGBA", lower_sheet.size)
    frames = []
    for index, (main_shoulder, off_shoulder) in enumerate(zip(WALK_MAIN_SHOULDERS, WALK_OFF_SHOULDERS)):
        source = sheet_frame(walking, index)
        lower = sheet_frame(lower_sheet, index)
        center_x = round((main_shoulder[0] + off_shoulder[0]) / 2)
        # The central mask excludes both swinging arms but keeps the same frame's
        # skull, rib cage and lumbar spine through the pelvis overlap. The clean
        # lower layer underneath supplies only pelvis/legs from that same frame.
        torso_mask = polygon_mask(FRAME, [[
            (main_shoulder[0] + 7, 0),
            (off_shoulder[0] - 7, 0),
            (off_shoulder[0] - 5, off_shoulder[1] + 18),
            (center_x + 25, 225),
            (center_x - 25, 225),
            (main_shoulder[0] + 5, main_shoulder[1] + 18),
        ]])
        torso = source.copy()
        torso.putalpha(ImageChops.multiply(source.getchannel("A"), torso_mask))
        core = lower.copy()
        core.alpha_composite(torso)
        x, y = index % COLS * FRAME[0], index // COLS * FRAME[1]
        body_sheet.alpha_composite(core, (x, y))
        frames.append(core)
    body_sheet.save(RUNTIME_BODY)
    return frames


def render_frames(lower_sheet):
    idle = Image.open(IDLE).convert("RGBA")
    body_frames = build_native_body(lower_sheet)
    main_arm = polygon_part(idle, MAIN_POLYGONS)
    off_upper = polygon_part(idle, [OFF_UPPER])
    off_forearm = polygon_part(idle, [OFF_FOREARM])
    off_hand = polygon_part(idle, [OFF_HAND])

    shield_visual, shield_path = load_shield_preview_config()
    shield, shield_pivot = prepare_shield(shield_visual, shield_path)
    red_shield_visual, red_shield_path = load_shield_preview_config(RED_SHIELD_WEAPON_ID)
    red_shield, red_shield_pivot = prepare_shield(red_shield_visual, red_shield_path)

    hands_frames = []
    guard_frames = []
    red_guard_frames = []
    bboxes = []
    shield_head_shoulder_overlap = []
    red_shield_head_shoulder_overlap = []
    red_visible_palm_pixels = []
    for index in range(FRAME_COUNT):
        bbox = body_frames[index].getchannel("A").getbbox()
        bboxes.append(list(bbox) if bbox else None)
        main_shoulder = (
            WALK_MAIN_SHOULDERS[index][0] + PREVIEW_OFFSET_X,
            WALK_MAIN_SHOULDERS[index][1] + PREVIEW_OFFSET_Y,
        )
        off_shoulder = (
            WALK_OFF_SHOULDERS[index][0] + PREVIEW_OFFSET_X,
            WALK_OFF_SHOULDERS[index][1] + PREVIEW_OFFSET_Y,
        )
        off_elbow = turn(OFF_ELBOW, OFF_SHOULDER, off_shoulder, GUARD_UPPER_DEGREES)
        off_grip = turn(OFF_GRIP, OFF_ELBOW, off_elbow, GUARD_FOREARM_DEGREES)
        core = body_frames[index].resize(BODY_FRAME, Image.Resampling.LANCZOS)
        core_layer = Image.new("RGBA", PREVIEW_FRAME)
        core_layer.alpha_composite(core, (PREVIEW_OFFSET_X, PREVIEW_OFFSET_Y))
        character = core_layer.copy()
        character.alpha_composite(place(main_arm, MAIN_SHOULDER, main_shoulder, 0, PREVIEW_FRAME))
        character.alpha_composite(place(off_upper, OFF_SHOULDER, off_shoulder, GUARD_UPPER_DEGREES, PREVIEW_FRAME))
        character.alpha_composite(place(off_forearm, OFF_ELBOW, off_elbow, GUARD_FOREARM_DEGREES, PREVIEW_FRAME))
        frame = Image.new("RGBA", PREVIEW_FRAME, (48, 52, 58, 255))
        frame.alpha_composite(character)
        hands_frames.append(frame)
        shield_layer = place(shield, shield_pivot, off_grip, GUARD_SHIELD_DEGREES, PREVIEW_FRAME)
        core_alpha = core_layer.getchannel("A").crop((
            0, PREVIEW_OFFSET_Y, PREVIEW_FRAME[0], PREVIEW_OFFSET_Y + 160
        ))
        shield_alpha = shield_layer.getchannel("A").crop((
            0, PREVIEW_OFFSET_Y, PREVIEW_FRAME[0], PREVIEW_OFFSET_Y + 160
        ))
        overlap = ImageChops.multiply(core_alpha, shield_alpha)
        shield_head_shoulder_overlap.append(sum(overlap.histogram()[17:]))
        guarded = frame.copy()
        guarded.alpha_composite(shield_layer)
        guard_frames.append(guarded)
        red_shield_layer = place(
            red_shield, red_shield_pivot, off_grip, GUARD_SHIELD_DEGREES, PREVIEW_FRAME
        )
        red_shield_alpha = red_shield_layer.getchannel("A").crop((
            0, PREVIEW_OFFSET_Y, PREVIEW_FRAME[0], PREVIEW_OFFSET_Y + 160
        ))
        red_overlap = ImageChops.multiply(core_alpha, red_shield_alpha)
        red_shield_head_shoulder_overlap.append(sum(red_overlap.histogram()[17:]))
        red_hand_layer = place(
            off_hand, OFF_ELBOW, off_elbow, GUARD_FOREARM_DEGREES, PREVIEW_FRAME
        )
        red_visible_hand = ImageChops.multiply(
            red_hand_layer.getchannel("A"), ImageChops.invert(red_shield_layer.getchannel("A"))
        )
        red_visible_palm_pixels.append(sum(red_visible_hand.histogram()[17:]))
        red_guarded = frame.copy()
        red_guarded.alpha_composite(red_shield_layer)
        red_guard_frames.append(red_guarded)
    return (
        hands_frames, guard_frames, red_guard_frames, bboxes,
        shield_head_shoulder_overlap, red_shield_head_shoulder_overlap,
        red_visible_palm_pixels, shield_visual,
    )


def save_gif(frames, path):
    durations = [round((i + 1) * 1000 / 24) - round(i * 1000 / 24) for i in range(FRAME_COUNT)]
    images = [frame.resize(PREVIEW_OUTPUT, Image.Resampling.LANCZOS).convert("P", palette=Image.Palette.ADAPTIVE)
              for frame in frames]
    images[0].save(path, save_all=True, append_images=images[1:], duration=durations,
                   loop=0, disposal=2, optimize=False)


def save_contact(hands_frames, guard_frames):
    keyframes = [0, 5, 10, 15, 20]
    board = Image.new("RGBA", (
        PREVIEW_OUTPUT[0] * len(keyframes), PREVIEW_OUTPUT[1] * 2 + 20
    ), (48, 52, 58, 255))
    draw = ImageDraw.Draw(board)
    for column, index in enumerate(keyframes):
        x = column * PREVIEW_OUTPUT[0]
        board.alpha_composite(hands_frames[index].resize(PREVIEW_OUTPUT, Image.Resampling.LANCZOS), (x, 20))
        board.alpha_composite(guard_frames[index].resize(PREVIEW_OUTPUT, Image.Resampling.LANCZOS), (
            x, PREVIEW_OUTPUT[1] + 20
        ))
        draw.text((x + 8, 4), f"frame {index}", fill="white")
    board.save(CONTACT)


def render_standing_guard(shield_visual, shield_path):
    idle = Image.open(IDLE).convert("RGBA")
    remove_mask = polygon_mask(BODY_FRAME, [OFF_UPPER, OFF_FOREARM])
    body = idle.copy()
    body.putalpha(ImageChops.multiply(idle.getchannel("A"), ImageChops.invert(remove_mask)))
    upper = polygon_part(idle, [OFF_UPPER])
    forearm = polygon_part(idle, [OFF_FOREARM])
    shoulder = (OFF_SHOULDER[0] + PREVIEW_OFFSET_X, OFF_SHOULDER[1] + PREVIEW_OFFSET_Y)
    elbow = turn(OFF_ELBOW, OFF_SHOULDER, shoulder, STAND_GUARD_UPPER_DEGREES)
    grip = turn(OFF_GRIP, OFF_ELBOW, elbow, STAND_GUARD_FOREARM_DEGREES)
    character = Image.new("RGBA", PREVIEW_FRAME)
    character.alpha_composite(body, (PREVIEW_OFFSET_X, PREVIEW_OFFSET_Y))
    character.alpha_composite(place(
        upper, OFF_SHOULDER, shoulder, STAND_GUARD_UPPER_DEGREES, PREVIEW_FRAME
    ))
    character.alpha_composite(place(
        forearm, OFF_ELBOW, elbow, STAND_GUARD_FOREARM_DEGREES, PREVIEW_FRAME
    ))
    shield, shield_pivot = prepare_shield(shield_visual, shield_path)
    frame = Image.new("RGBA", PREVIEW_FRAME, (48, 52, 58, 255))
    frame.alpha_composite(character)
    frame.alpha_composite(place(shield, shield_pivot, grip, GUARD_SHIELD_DEGREES, PREVIEW_FRAME))
    return frame


def save_standing_previews(configs):
    rendered = [(visual, render_standing_guard(visual, path)) for visual, path in configs]
    for visual, frame in rendered:
        if visual["weaponId"] == SHIELD_WEAPON_ID:
            frame.resize(PREVIEW_OUTPUT, Image.Resampling.LANCZOS).save(PREVIEW_STAND_GUARD)
        elif visual["weaponId"] == RED_SHIELD_WEAPON_ID:
            frame.resize(PREVIEW_OUTPUT, Image.Resampling.LANCZOS).save(PREVIEW_RED_STAND_GUARD)
    columns = 4
    rows = math.ceil(len(rendered) / columns)
    label_height = 24
    board = Image.new("RGBA", (
        PREVIEW_OUTPUT[0] * columns,
        (PREVIEW_OUTPUT[1] + label_height) * rows,
    ), (48, 52, 58, 255))
    draw = ImageDraw.Draw(board)
    for index, (visual, frame) in enumerate(rendered):
        x = index % columns * PREVIEW_OUTPUT[0]
        y = index // columns * (PREVIEW_OUTPUT[1] + label_height)
        board.alpha_composite(frame.resize(PREVIEW_OUTPUT, Image.Resampling.LANCZOS), (x, y + label_height))
        draw.text((x + 8, y + 6), visual["weaponId"], fill="white")
    board.save(PREVIEW_ALL_STANDING)


def main():
    lower_sheet = load_reviewed_lower()
    (
        hands_frames, guard_frames, red_guard_frames, bboxes,
        shield_head_shoulder_overlap, red_shield_head_shoulder_overlap,
        red_visible_palm_pixels, shield_visual,
    ) = render_frames(lower_sheet)
    all_shield_configs = load_all_shield_preview_configs()
    baseline_grip = guard_grip_offset(BASELINE_GUARD_UPPER_DEGREES, BASELINE_GUARD_FOREARM_DEGREES)
    previous_grip = guard_grip_offset(PREVIOUS_GUARD_UPPER_DEGREES, PREVIOUS_GUARD_FOREARM_DEGREES)
    current_grip = guard_grip_offset(GUARD_UPPER_DEGREES, GUARD_FOREARM_DEGREES)
    baseline_grip_delta = [round(current - baseline, 3) for current, baseline in zip(current_grip, baseline_grip)]
    previous_grip_delta = [round(current - previous, 3) for current, previous in zip(current_grip, previous_grip)]
    save_gif(hands_frames, PREVIEW_HANDS)
    save_gif(guard_frames, PREVIEW_GUARD)
    save_gif(red_guard_frames, PREVIEW_RED_GUARD)
    save_contact(hands_frames, guard_frames)
    save_standing_previews(all_shield_configs)
    REPORT.write_text(json.dumps({
        "source": str(SOURCE_ARCHIVE.relative_to(ROOT)).replace("\\", "/"),
        "runtimeBody": str(RUNTIME_BODY.relative_to(ROOT)).replace("\\", "/"),
        "upperSource": "native walking head, rib cage and lumbar from the same frame",
        "armSource": "assets/player/idle.png at initial proportions, attached to per-frame walking shoulders",
        "shieldVisual": shield_visual,
        "allShieldMidGripVisuals": [visual for visual, _path in all_shield_configs],
        "walkGuardTiltRadians": WALK_GUARD_TILT,
        "standGuardArmDegrees": {
            "upper": STAND_GUARD_UPPER_DEGREES,
            "forearm": STAND_GUARD_FOREARM_DEGREES,
        },
        "walkGuardArmDegrees": {
            "upper": GUARD_UPPER_DEGREES,
            "forearm": GUARD_FOREARM_DEGREES,
        },
        "baselineGuardArmDegrees": {
            "upper": BASELINE_GUARD_UPPER_DEGREES,
            "forearm": BASELINE_GUARD_FOREARM_DEGREES,
        },
        "previousGuardArmDegrees": {
            "upper": PREVIOUS_GUARD_UPPER_DEGREES,
            "forearm": PREVIOUS_GUARD_FOREARM_DEGREES,
        },
        "fullGuardGripDeltaFromBaselinePixels": baseline_grip_delta,
        "fullGuardGripDeltaFromPreviousPixels": previous_grip_delta,
        "previewFrame": list(PREVIEW_FRAME),
        "previewOutput": list(PREVIEW_OUTPUT),
        "previewPolicy": "wide fixed canvas keeps the complete detached shield visible without changing runtime placement",
        "perspectivePolicy": (
            "weapon17 is the moderate guard-view baseline at scaleX=0.74; "
            "weapon57-61 use authored oblique guard images at scaleX=1.0"
        ),
        "horizontalGripPolicy": (
            "defenseOriginX is independent from the ordinary originX; weapon57 uses 0.42 "
            "to hide the palm behind the shield face while preserving its non-defense grip"
        ),
        "shieldHeadShoulderOverlapPixelsByFrame": shield_head_shoulder_overlap,
        "shieldHeadShoulderOverlapMax": max(shield_head_shoulder_overlap),
        "oakGarrisonHeadShoulderOverlapPixelsByFrame": red_shield_head_shoulder_overlap,
        "oakGarrisonHeadShoulderOverlapMax": max(red_shield_head_shoulder_overlap),
        "oakGarrisonVisiblePalmPixelsByFrame": red_visible_palm_pixels,
        "oakGarrisonVisiblePalmPixelsMax": max(red_visible_palm_pixels),
        "lowerSource": "native walking pelvis, thighs, knees, shins and feet; no arm pixels",
        "frameWidth": FRAME[0],
        "frameHeight": FRAME[1],
        "frameCount": FRAME_COUNT,
        "frameRate": 24,
        "alphaBboxes": bboxes,
        "runtimeTested": False,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for path in (
        SOURCE_ARCHIVE, RUNTIME_BODY, PREVIEW_HANDS, PREVIEW_GUARD, PREVIEW_RED_GUARD,
        PREVIEW_STAND_GUARD, PREVIEW_RED_STAND_GUARD, PREVIEW_ALL_STANDING,
        CONTACT, REPORT
    ):
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
