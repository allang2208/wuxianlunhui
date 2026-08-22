from collections import deque
from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[2]
BODY_SOURCE = ROOT / "new_body_user.png"
ROTOR_SOURCE_DIR = ROOT / "rendered"
BODY_OUTPUT = PROJECT_ROOT / "assets" / "terrain" / "wheat_windmill_body.png"
ROTOR_OUTPUT = PROJECT_ROOT / "assets" / "terrain" / "wheat_windmill_rotor.png"
PREVIEW_OUTPUT = ROOT / "new_body_interpolated_contact.png"
METADATA_OUTPUT = ROOT / "new_body_interpolated_assets.json"

SOURCE_FRAME_SIZE = 1024
SOURCE_FRAME_COUNT = 16
OUTPUT_FRAME_COUNT = 32
BODY_OUTPUT_SIZE = (512, 640)
ROTOR_FRAME_SIZE = (768, 768)
BODY_DISPLAY_SIZE = (276, 340)
ROTOR_DISPLAY_SIZE = (428, 428)
SHEET_COLUMNS = 8
SHEET_ROWS = 4

# The original 3D-rendered rotor pivot. The former candidate used +22/+5 to
# meet its body hub at 632/444, so the unshifted source pivot is 610/439.
SOURCE_ROTOR_PIVOT = (610, 439)

# Measured from the user-supplied body: center of the forward gold axle cap.
SOURCE_BODY_HUB = (767, 586)
SOURCE_BODY_SIZE = (1124, 1399)

# Repack 1024px source frames into 768px frames, then display them at 428px.
# 0.75 * (428 / 768) == 428 / 1024, so the in-game blade size is unchanged.
ROTOR_SCALE = 0.75


def extract_checkerboard_alpha(image: Image.Image) -> Image.Image:
    """Remove only the border-connected light neutral checkerboard."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    highest = rgb.max(axis=2)
    lowest = rgb.min(axis=2)
    background_candidate = (lowest >= 225) & ((highest - lowest) <= 14)
    height, width = background_candidate.shape
    exterior = np.zeros((height, width), dtype=np.uint8)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        if background_candidate[y, x] and exterior[y, x] == 0:
            exterior[y, x] = 1
            queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    alpha = Image.fromarray(np.where(exterior == 1, 0, 255).astype(np.uint8), mode="L")
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.55))
    rgba = image.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba


def fit_body_to_runtime_canvas(body: Image.Image) -> Image.Image:
    target_width, target_height = BODY_OUTPUT_SIZE
    fitted_height = round(body.height * target_width / body.width)
    if fitted_height > target_height:
        raise ValueError("New windmill body no longer fits the configured runtime frame")
    resized = body.resize((target_width, fitted_height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", BODY_OUTPUT_SIZE, (0, 0, 0, 0))
    canvas.alpha_composite(resized, (0, (target_height - fitted_height) // 2))
    return canvas


def rotate_about_pivot(frame: Image.Image, degrees: float) -> Image.Image:
    return frame.rotate(
        degrees,
        resample=Image.Resampling.BICUBIC,
        center=SOURCE_ROTOR_PIVOT,
        expand=False,
    )


def alpha_mse(first: Image.Image, second: Image.Image) -> float:
    a = np.asarray(first.getchannel("A"), dtype=np.float32)
    b = np.asarray(second.getchannel("A"), dtype=np.float32)
    return float(np.mean((a - b) ** 2))


def premultiplied_average(first: Image.Image, second: Image.Image) -> Image.Image:
    a = np.asarray(first.convert("RGBA"), dtype=np.float32) / 255.0
    b = np.asarray(second.convert("RGBA"), dtype=np.float32) / 255.0
    alpha_a = a[..., 3:4]
    alpha_b = b[..., 3:4]
    alpha = (alpha_a + alpha_b) * 0.5
    premultiplied = (a[..., :3] * alpha_a + b[..., :3] * alpha_b) * 0.5
    rgb = np.divide(
        premultiplied,
        alpha,
        out=np.zeros_like(premultiplied),
        where=alpha > 1e-6,
    )
    result = np.concatenate((rgb, alpha), axis=2)
    return Image.fromarray(np.clip(result * 255.0, 0, 255).astype(np.uint8), mode="RGBA")


def color_match_rotor(frame: Image.Image) -> Image.Image:
    # The new body uses warmer medium-brown timber. Keep the original blade
    # texture intact while reducing its red saturation and lifting dark wood.
    frame = ImageEnhance.Color(frame).enhance(0.90)
    return ImageEnhance.Brightness(frame).enhance(1.10)


def place_rotor_on_runtime_canvas(frame: Image.Image) -> Image.Image:
    size = round(SOURCE_FRAME_SIZE * ROTOR_SCALE)
    resized = color_match_rotor(frame).resize((size, size), Image.Resampling.LANCZOS)
    pivot_x = round(SOURCE_ROTOR_PIVOT[0] * ROTOR_SCALE)
    pivot_y = round(SOURCE_ROTOR_PIVOT[1] * ROTOR_SCALE)
    rotor_center = (ROTOR_FRAME_SIZE[0] // 2, ROTOR_FRAME_SIZE[1] // 2)
    canvas = Image.new("RGBA", ROTOR_FRAME_SIZE, (0, 0, 0, 0))
    canvas.alpha_composite(resized, (rotor_center[0] - pivot_x, rotor_center[1] - pivot_y))
    return canvas


def build_hub_foreground(body: Image.Image, hub: tuple[int, int]) -> Image.Image:
    mask = Image.new("L", BODY_OUTPUT_SIZE, 0)
    draw = ImageDraw.Draw(mask)
    radius_x = round(78 * BODY_OUTPUT_SIZE[0] / SOURCE_BODY_SIZE[0])
    radius_y = round(88 * BODY_OUTPUT_SIZE[1] / SOURCE_BODY_SIZE[1])
    draw.ellipse(
        (hub[0] - radius_x, hub[1] - radius_y, hub[0] + radius_x, hub[1] + radius_y),
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(radius=0.8))
    mask = ImageChops.multiply(mask, body.getchannel("A"))
    body_patch = body.copy()
    body_patch.putalpha(mask)
    crop_box = (
        hub[0] - radius_x - 2,
        hub[1] - radius_y - 2,
        hub[0] + radius_x + 3,
        hub[1] + radius_y + 3,
    )
    body_patch = body_patch.crop(crop_box)
    scale_x = (BODY_DISPLAY_SIZE[0] / BODY_OUTPUT_SIZE[0]) / (ROTOR_DISPLAY_SIZE[0] / ROTOR_FRAME_SIZE[0])
    scale_y = (BODY_DISPLAY_SIZE[1] / BODY_OUTPUT_SIZE[1]) / (ROTOR_DISPLAY_SIZE[1] / ROTOR_FRAME_SIZE[1])
    patch_size = (
        max(1, round(body_patch.width * scale_x)),
        max(1, round(body_patch.height * scale_y)),
    )
    body_patch = body_patch.resize(patch_size, Image.Resampling.LANCZOS)
    foreground = Image.new("RGBA", ROTOR_FRAME_SIZE, (0, 0, 0, 0))
    rotor_center = (ROTOR_FRAME_SIZE[0] // 2, ROTOR_FRAME_SIZE[1] // 2)
    foreground.alpha_composite(
        body_patch,
        (rotor_center[0] - patch_size[0] // 2, rotor_center[1] - patch_size[1] // 2),
    )
    return foreground


def compose_runtime_preview(body: Image.Image, overlay: Image.Image, hub_offset: tuple[float, float]) -> Image.Image:
    canvas_size = (600, 600)
    canvas_center = (canvas_size[0] // 2, canvas_size[1] // 2)
    canvas = Image.new("RGBA", canvas_size, (25, 25, 25, 255))
    body_display = body.resize(BODY_DISPLAY_SIZE, Image.Resampling.LANCZOS)
    overlay_display = overlay.resize(ROTOR_DISPLAY_SIZE, Image.Resampling.LANCZOS)
    canvas.alpha_composite(
        body_display,
        (canvas_center[0] - BODY_DISPLAY_SIZE[0] // 2, canvas_center[1] - BODY_DISPLAY_SIZE[1] // 2),
    )
    overlay_center = (
        round(canvas_center[0] + hub_offset[0]),
        round(canvas_center[1] + hub_offset[1]),
    )
    canvas.alpha_composite(
        overlay_display,
        (overlay_center[0] - ROTOR_DISPLAY_SIZE[0] // 2, overlay_center[1] - ROTOR_DISPLAY_SIZE[1] // 2),
    )
    return canvas


def main() -> None:
    body_source = Image.open(BODY_SOURCE).convert("RGB")
    if body_source.size != SOURCE_BODY_SIZE:
        raise ValueError(f"Expected body source {SOURCE_BODY_SIZE}, got {body_source.size}")
    body = fit_body_to_runtime_canvas(extract_checkerboard_alpha(body_source))
    body.save(BODY_OUTPUT, optimize=True)

    source_frames = [
        Image.open(ROTOR_SOURCE_DIR / f"sails_{index:02d}.png").convert("RGBA")
        for index in range(SOURCE_FRAME_COUNT)
    ]
    step_degrees = 90.0 / SOURCE_FRAME_COUNT
    positive_error = alpha_mse(rotate_about_pivot(source_frames[0], step_degrees), source_frames[1])
    negative_error = alpha_mse(rotate_about_pivot(source_frames[0], -step_degrees), source_frames[1])
    direction = 1.0 if positive_error <= negative_error else -1.0
    half_step = direction * step_degrees * 0.5

    fitted_height = round(SOURCE_BODY_SIZE[1] * BODY_OUTPUT_SIZE[0] / SOURCE_BODY_SIZE[0])
    top_padding = (BODY_OUTPUT_SIZE[1] - fitted_height) // 2
    runtime_hub = (
        round(SOURCE_BODY_HUB[0] * BODY_OUTPUT_SIZE[0] / SOURCE_BODY_SIZE[0]),
        top_padding + round(SOURCE_BODY_HUB[1] * fitted_height / SOURCE_BODY_SIZE[1]),
    )
    hub_offset = (
        (runtime_hub[0] - BODY_OUTPUT_SIZE[0] / 2) * BODY_DISPLAY_SIZE[0] / BODY_OUTPUT_SIZE[0],
        (runtime_hub[1] - BODY_OUTPUT_SIZE[1] / 2) * BODY_DISPLAY_SIZE[1] / BODY_OUTPUT_SIZE[1],
    )
    hub_foreground = build_hub_foreground(body, runtime_hub)

    interpolated: list[Image.Image] = []
    for index, current in enumerate(source_frames):
        following = source_frames[(index + 1) % SOURCE_FRAME_COUNT]
        interpolated.append(current)
        forward = rotate_about_pivot(current, half_step)
        backward = rotate_about_pivot(following, -half_step)
        interpolated.append(premultiplied_average(forward, backward))

    sheet = Image.new(
        "RGBA",
        (ROTOR_FRAME_SIZE[0] * SHEET_COLUMNS, ROTOR_FRAME_SIZE[1] * SHEET_ROWS),
        (0, 0, 0, 0),
    )
    runtime_frames: list[Image.Image] = []
    for index, frame in enumerate(interpolated):
        runtime_frame = place_rotor_on_runtime_canvas(frame)
        runtime_frame.alpha_composite(hub_foreground)
        runtime_frames.append(runtime_frame)
        x = (index % SHEET_COLUMNS) * ROTOR_FRAME_SIZE[0]
        y = (index // SHEET_COLUMNS) * ROTOR_FRAME_SIZE[1]
        sheet.alpha_composite(runtime_frame, (x, y))
    sheet.save(ROTOR_OUTPUT, optimize=True)

    preview_size = (600, 600)
    contact = Image.new("RGBA", (preview_size[0] * 2, preview_size[1] * 2), (25, 25, 25, 255))
    for slot, frame_index in enumerate((0, 8, 16, 24)):
        composed = compose_runtime_preview(body, runtime_frames[frame_index], hub_offset)
        contact.alpha_composite(composed, ((slot % 2) * preview_size[0], (slot // 2) * preview_size[1]))
    contact.save(PREVIEW_OUTPUT, optimize=True)

    metadata = {
        "bodySource": BODY_SOURCE.name,
        "frameWidth": ROTOR_FRAME_SIZE[0],
        "frameHeight": ROTOR_FRAME_SIZE[1],
        "frameCount": OUTPUT_FRAME_COUNT,
        "columns": SHEET_COLUMNS,
        "rows": SHEET_ROWS,
        "runtimeHub": {"x": runtime_hub[0], "y": runtime_hub[1]},
        "overlayOffset": {"x": hub_offset[0], "y": hub_offset[1]},
        "bodyDisplay": {"width": BODY_DISPLAY_SIZE[0], "height": BODY_DISPLAY_SIZE[1]},
        "rotorDisplay": {"width": ROTOR_DISPLAY_SIZE[0], "height": ROTOR_DISPLAY_SIZE[1]},
        "sourceRotorPivot": {"x": SOURCE_ROTOR_PIVOT[0], "y": SOURCE_ROTOR_PIVOT[1]},
        "rotorScale": ROTOR_SCALE,
        "interpolation": "bidirectional half-angle warp plus premultiplied-alpha blend",
        "rotationDirection": direction,
        "frameRate": 17.4,
    }
    METADATA_OUTPUT.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
