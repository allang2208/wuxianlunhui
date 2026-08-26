"""Finalize the accepted V2 body, panel image and independent rotor sheet."""

from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[3]
SELECTED_RAW = (ROOT / "refine_48step_from_v02_seed122561" / "wind_power_plant"
                / "wind_power_plant_refine_v02_raw.png")
USER_BODY = ROOT / "wind_power_plant_body_user.png"
FULL_DEPTH = ROOT / "wind_power_plant_depth.png"
ROTOR_DIR = ROOT / "rotor_sources"

PANEL_OUTPUT = PROJECT / "assets" / "terrain" / "wind_power_plant.png"
BODY_OUTPUT = PROJECT / "assets" / "terrain" / "wind_power_plant_body.png"
ROTOR_OUTPUT = PROJECT / "assets" / "terrain" / "wind_power_plant_rotor.png"
PREVIEW_OUTPUT = ROOT / "wind_power_plant_layered_contact.png"
GIF_OUTPUT = ROOT / "wind_power_plant_rotation_preview.gif"
PANEL_METADATA = ROOT / "wind_power_plant_runtime_metadata.json"
BODY_METADATA = ROOT / "wind_power_plant_body_runtime_metadata.json"
ANIMATION_METADATA = ROOT / "wind_power_plant_animation_metadata.json"

DISPLAY_WIDTH = 512
ROTOR_FRAME_SIZE = 512
ROTOR_FRAME_COUNT = 24
ROTOR_COLUMNS = 6
ROTOR_ROWS = 4
ROTOR_FRAME_RATE = 12


def manual_rgba_import(source_path: Path, output_path: Path,
                       metadata_path: Path) -> tuple[Image.Image, dict]:
    """Import the user's hand-cut body without re-keying or moving its pixels."""
    source = Image.open(source_path).convert("RGBA")
    if source.size != (1024, 1024):
        raise SystemExit(f"manual body must remain 1024x1024, got {source.size}")
    rgba = np.asarray(source, dtype=np.uint8).copy()
    alpha = rgba[..., 3]
    ys, xs = np.where(alpha > 0)
    if not len(xs):
        raise SystemExit("manual body has an empty alpha channel")
    padding = 4
    crop = (
        max(0, int(xs.min()) - padding),
        max(0, int(ys.min()) - padding),
        min(source.width, int(xs.max()) + 1 + padding),
        min(source.height, int(ys.max()) + 1 + padding),
    )
    rgba[alpha == 0, :3] = 0
    output = Image.fromarray(
        rgba[crop[1]:crop[3], crop[0]:crop[2]], "RGBA")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path, optimize=True)

    file_width, file_height = output.size
    scale = DISPLAY_WIDTH / file_width
    display_height = round(file_height * scale)
    local_alpha = np.asarray(output.getchannel("A"), dtype=np.uint8)
    local_ys, local_xs = np.where(local_alpha > 0)
    foot_offset = round(((int(local_ys.max()) + 1) - file_height / 2.0) * scale)
    metadata = {
        "source": str(source_path.relative_to(PROJECT)).replace("/", "\\"),
        "output": str(output_path.relative_to(PROJECT)).replace("/", "\\"),
        "method": "user-supplied RGBA alpha preserved; deterministic tight crop only",
        "cropBox": list(crop),
        "fileSize": [file_width, file_height],
        "alphaBBox": [int(local_xs.min()), int(local_ys.min()),
                      int(local_xs.max()) + 1, int(local_ys.max()) + 1],
        "displayW": DISPLAY_WIDTH,
        "displayH": display_height,
        "footOffsetY": foot_offset,
        "scaleX": scale,
        "scaleY": display_height / file_height,
    }
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output, metadata


def green_cutout(source_path: Path, depth_path: Path, output_path: Path,
                 metadata_path: Path) -> tuple[Image.Image, dict]:
    source = Image.open(source_path).convert("RGB")
    rgb = np.asarray(source, dtype=np.uint8).copy()
    values = rgb.astype(np.float32)
    red, green, blue = (values[..., index] for index in range(3))

    # Key only pixels whose green channel dominates both red and blue.  This
    # deliberately avoids Euclidean matte-distance floods: V2 uses large
    # blue-gray slate and stone areas that the generic flat-background helper
    # can otherwise misclassify as a dark green shadow.
    green_advantage = np.minimum(green - red, green - blue)
    matte_mix = np.clip((green_advantage - 18.0) / 38.0, 0.0, 1.0)
    matte_mix *= np.clip((green - 70.0) / 70.0, 0.0, 1.0)
    alpha = 1.0 - matte_mix

    depth = Image.open(depth_path).convert("L")
    if depth.size != source.size:
        depth = depth.resize(source.size, Image.Resampling.BILINEAR)
    modeled = np.asarray(depth, dtype=np.uint8) > 3
    modeled = ndimage.binary_dilation(modeled, iterations=14)
    modeled_soft = ndimage.gaussian_filter(modeled.astype(np.float32), sigma=0.65)
    alpha *= np.clip(modeled_soft, 0.0, 1.0)

    alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    alpha_u8[alpha_u8 < 8] = 0
    reliable = alpha_u8 >= 250
    edge = (alpha_u8 > 0) & ~reliable
    if np.any(edge) and np.any(reliable):
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]

    labels, count = ndimage.label(alpha_u8 > 0, structure=np.ones((3, 3), dtype=np.uint8))
    if count:
        sizes = np.bincount(labels.ravel())
        small = np.where((sizes < 18) & (np.arange(len(sizes)) > 0))[0]
        if len(small):
            alpha_u8[np.isin(labels, small)] = 0

    ys, xs = np.where(alpha_u8 > 0)
    if not len(xs):
        raise SystemExit(f"empty alpha after green key: {source_path}")
    padding = 4
    crop = (
        max(0, int(xs.min()) - padding),
        max(0, int(ys.min()) - padding),
        min(source.width, int(xs.max()) + 1 + padding),
        min(source.height, int(ys.max()) + 1 + padding),
    )
    rgb[alpha_u8 == 0] = 0
    rgba = np.dstack((rgb, alpha_u8))[crop[1]:crop[3], crop[0]:crop[2]]
    output = Image.fromarray(rgba, "RGBA")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path, optimize=True)

    file_width, file_height = output.size
    scale = DISPLAY_WIDTH / file_width
    display_height = round(file_height * scale)
    local_alpha = np.asarray(output.getchannel("A"), dtype=np.uint8)
    local_ys, local_xs = np.where(local_alpha > 0)
    foot_offset = round(((int(local_ys.max()) + 1) - file_height / 2.0) * scale)
    metadata = {
        "source": str(source_path.relative_to(PROJECT)).replace("/", "\\"),
        "output": str(output_path.relative_to(PROJECT)).replace("/", "\\"),
        "method": "green-channel advantage key plus dilated Blender silhouette",
        "depthMask": str(depth_path.relative_to(PROJECT)).replace("/", "\\"),
        "cropBox": list(crop),
        "fileSize": [file_width, file_height],
        "alphaBBox": [int(local_xs.min()), int(local_ys.min()),
                      int(local_xs.max()) + 1, int(local_ys.max()) + 1],
        "displayW": DISPLAY_WIDTH,
        "displayH": display_height,
        "footOffsetY": foot_offset,
        "scaleX": scale,
        "scaleY": display_height / file_height,
    }
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output, metadata


def rotor_hub_source() -> tuple[int, int]:
    mask = Image.open(ROTOR_DIR / "rotor_hub_mask.png").convert("RGBA")
    alpha = np.asarray(mask.getchannel("A"), dtype=np.uint8)
    white = np.asarray(mask.getchannel("R"), dtype=np.uint8)
    ys, xs = np.where((alpha > 16) & (white > 96))
    if not len(xs):
        raise SystemExit("empty rotor hub mask")
    return round((int(xs.min()) + int(xs.max()) + 1) / 2), round(
        (int(ys.min()) + int(ys.max()) + 1) / 2)


def crop_rotor_frame(frame: Image.Image, hub: tuple[int, int]) -> Image.Image:
    half = ROTOR_FRAME_SIZE // 2
    box = (hub[0] - half, hub[1] - half, hub[0] + half, hub[1] + half)
    return frame.convert("RGBA").crop(box)


def compose_preview(body: Image.Image, rotor: Image.Image, body_meta: dict,
                    overlay_meta: dict) -> Image.Image:
    canvas = Image.new("RGBA", (620, 580), (23, 25, 28, 255))
    body_display = body.resize(
        (body_meta["displayW"], body_meta["displayH"]), Image.Resampling.LANCZOS)
    rotor_display = rotor.resize(
        (overlay_meta["displayW"], overlay_meta["displayH"]), Image.Resampling.LANCZOS)
    center = (310, 316)
    canvas.alpha_composite(body_display, (
        center[0] - body_display.width // 2,
        center[1] - body_display.height // 2,
    ))
    overlay_center = (
        center[0] + round(overlay_meta["offsetX"]),
        center[1] + round(overlay_meta["offsetY"]),
    )
    canvas.alpha_composite(rotor_display, (
        overlay_center[0] - rotor_display.width // 2,
        overlay_center[1] - rotor_display.height // 2,
    ))
    return canvas


def main() -> None:
    panel, panel_meta = green_cutout(
        SELECTED_RAW, FULL_DEPTH, PANEL_OUTPUT, PANEL_METADATA)
    if not USER_BODY.exists():
        raise SystemExit(
            "accepted user body is required: wind_power_plant_body_user.png")
    body, body_meta = manual_rgba_import(
        USER_BODY, BODY_OUTPUT, BODY_METADATA)

    hub = rotor_hub_source()
    frames = [
        crop_rotor_frame(Image.open(ROTOR_DIR / f"rotor_{index:02d}.png"), hub)
        for index in range(ROTOR_FRAME_COUNT)
    ]
    sheet = Image.new(
        "RGBA", (ROTOR_FRAME_SIZE * ROTOR_COLUMNS, ROTOR_FRAME_SIZE * ROTOR_ROWS),
        (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (
            (index % ROTOR_COLUMNS) * ROTOR_FRAME_SIZE,
            (index // ROTOR_COLUMNS) * ROTOR_FRAME_SIZE,
        ))
    ROTOR_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(ROTOR_OUTPUT, optimize=True)

    scale = float(body_meta["scaleX"])
    crop_x0, crop_y0, crop_x1, crop_y1 = body_meta["cropBox"]
    body_center_source = ((crop_x0 + crop_x1) / 2.0, (crop_y0 + crop_y1) / 2.0)
    animation = {
        "textureKey": "wind_power_plant_rotor",
        "assetPath": "assets/terrain/wind_power_plant_rotor.png",
        "frameWidth": ROTOR_FRAME_SIZE,
        "frameHeight": ROTOR_FRAME_SIZE,
        "frameCount": ROTOR_FRAME_COUNT,
        "columns": ROTOR_COLUMNS,
        "rows": ROTOR_ROWS,
        "displayW": round(ROTOR_FRAME_SIZE * scale),
        "displayH": round(ROTOR_FRAME_SIZE * scale),
        "offsetX": (hub[0] - body_center_source[0]) * scale,
        "offsetY": (hub[1] - body_center_source[1]) * scale,
        "frameRate": ROTOR_FRAME_RATE,
        "repeat": -1,
        "sourceHub": {"x": hub[0], "y": hub[1]},
        "sourceFrameCount": ROTOR_FRAME_COUNT,
        "rotationDegreesPerFrame": 360.0 / ROTOR_FRAME_COUNT,
        "body": {
            "textureKey": "wind_power_plant_body",
            "assetPath": "assets/terrain/wind_power_plant_body.png",
            "displayW": body_meta["displayW"],
            "displayH": body_meta["displayH"],
            "footOffsetY": body_meta["footOffsetY"],
        },
        "panel": {
            "textureKey": "wind_power_plant",
            "assetPath": "assets/terrain/wind_power_plant.png",
            "displayW": panel_meta["displayW"],
            "displayH": panel_meta["displayH"],
        },
    }
    ANIMATION_METADATA.write_text(
        json.dumps(animation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    contact = Image.new("RGBA", (1240, 1160), (23, 25, 28, 255))
    for slot, frame_index in enumerate((0, 6, 12, 18)):
        preview = compose_preview(body, frames[frame_index], body_meta, animation)
        contact.alpha_composite(preview, (
            (slot % 2) * 620, (slot // 2) * 580))
    draw = ImageDraw.Draw(contact)
    draw.text((18, 18), "Wind power plant V2 - body + independent 24-frame rotor",
              fill=(235, 238, 242, 255))
    contact.save(PREVIEW_OUTPUT, optimize=True)

    gif_frames = [
        compose_preview(body, frame, body_meta, animation).convert("RGB")
        for frame in frames
    ]
    gif_frames[0].save(
        GIF_OUTPUT, save_all=True, append_images=gif_frames[1:], loop=0,
        duration=round(1000 / ROTOR_FRAME_RATE), optimize=False)

    print(json.dumps(animation, ensure_ascii=False, indent=2))
    print(PREVIEW_OUTPUT)
    print(GIF_OUTPUT)


if __name__ == "__main__":
    main()
