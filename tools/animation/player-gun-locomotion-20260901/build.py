import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "assets" / "player"
SOURCE_RUN = ROOT / "assets" / "character" / "running.png"
APPROVED_RUN_LEGS = ASSETS / "gun_run_legs.png"
APPROVED_WALK_LEGS = ASSETS / "gun_walk_legs.png"
OUTPUT_RUN_LEGS = ASSETS / "gun_run_legs_v2.png"
OUTPUT_WALK_LEGS = ASSETS / "gun_walk_legs_v2.png"
PREVIEW = Path(__file__).resolve().parent / "gun-run-splice-contact.png"
WALK_PREVIEW = Path(__file__).resolve().parent / "gun-walk-twist-contact.png"
PLAYER_ANIM_CONFIG = ROOT / "data" / "player-anim-config.json"

FRAME_SIZE = 512
RUN_FRAME_COUNT = 8
WALK_COLS = 8
WALK_ROWS = 3
WALK_FRAME_HEIGHT = 516
LEFT_SAFETY_PX = 4
SPLICE_TOP_Y = 248
WALK_SPLICE_TOP_Y = 238
WALK_SPLICE_BOTTOM_Y = 320
WALK_BRIDGE_PX = 6
WALK_BRIDGE_SIDE_PX = 8
WALK_PREVIEW_FRAMES = [0, 4, 8, 10, 11, 15, 20]
WALK_PREVIEW_ANGLES = [-40, 0, 40]

# 原 running.png 首行 8 帧到已认可 gun_run_legs.png 的固定平移。
# 这些值只恢复被旧裁片省掉的髋部拼接带；已认可腿层始终最后覆盖，轨迹不重算。
RUN_SOURCE_OFFSETS = [
    (-45, 13),
    (-29, -18),
    (-6, -19),
    (-22, -19),
    (-47, -19),
    (-74, -19),
    (-72, -19),
    (-53, 0),
]

# 与 player-anim-config.json 的 runLegs 同源，用于生成离线拼接检查图。
RUN_BODY_BOB_Y = [-5.8, -0.8, 3.2, 6.2, 6.2, -0.8, -3.8, -4.8]
RUN_BODY_BOB_X = [9.2, -11.8, -22.8, -15.4, -3.0, 13.1, 17.5, 13.4]


def require_size(image: Image.Image, expected: tuple[int, int], label: str) -> None:
    if image.size != expected:
        raise ValueError(f"{label} size {image.size}, expected {expected}")


def build_walk_legs() -> list[Image.Image]:
    source = Image.open(APPROVED_WALK_LEGS).convert("RGBA")
    require_size(source, (4100, WALK_ROWS * WALK_FRAME_HEIGHT), "gun_walk_legs source")
    # 旧图右侧多出 4px，Phaser 虽会忽略，但会让网格产物不再整除。
    normalized = source.crop((0, 0, WALK_COLS * FRAME_SIZE, WALK_ROWS * WALK_FRAME_HEIGHT))
    output = normalized.copy()
    frames: list[Image.Image] = []
    for index in range(21):
        col = index % WALK_COLS
        row = index // WALK_COLS
        raw = normalized.crop((
            col * FRAME_SIZE,
            row * WALK_FRAME_HEIGHT,
            (col + 1) * FRAME_SIZE,
            (row + 1) * WALK_FRAME_HEIGHT,
        ))
        frame = Image.new("RGBA", raw.size)
        band = raw.crop((0, WALK_SPLICE_TOP_Y, FRAME_SIZE, WALK_SPLICE_BOTTOM_Y))
        # 仅把腰胯拼接带向上补 1~2px，原认可帧最后覆盖。脚线、步幅、根点和
        # 离散帧轨迹完全不动；新增像素只作为极限 ±40° 躯干扭转下的背衬。
        for side in (-WALK_BRIDGE_SIDE_PX, 0, WALK_BRIDGE_SIDE_PX):
            for lift in range(WALK_BRIDGE_PX, 0, -1):
                frame.alpha_composite(band, (side, WALK_SPLICE_TOP_Y - lift))
        frame.alpha_composite(raw)
        # 整格替换，不能再叠到 normalized 原格上；否则所有半透明腿部边缘都会被
        # 二次 alpha-composite，造成拼接带之外的无关像素变化。
        output.paste(frame, (col * FRAME_SIZE, row * WALK_FRAME_HEIGHT))
        frames.append(frame)
    output.save(OUTPUT_WALK_LEGS)
    return frames


def build_run_legs() -> list[Image.Image]:
    full_run = Image.open(SOURCE_RUN).convert("RGBA")
    approved = Image.open(APPROVED_RUN_LEGS).convert("RGBA")
    require_size(full_run, (RUN_FRAME_COUNT * FRAME_SIZE, FRAME_SIZE * 2), "running source")
    require_size(approved, (RUN_FRAME_COUNT * FRAME_SIZE, FRAME_SIZE), "gun_run_legs source")

    output = Image.new("RGBA", (RUN_FRAME_COUNT * FRAME_SIZE, FRAME_SIZE))
    frames: list[Image.Image] = []
    for index, (source_dx, source_dy) in enumerate(RUN_SOURCE_OFFSETS):
        source_frame = full_run.crop((index * FRAME_SIZE, 0, (index + 1) * FRAME_SIZE, FRAME_SIZE))
        approved_frame = approved.crop((index * FRAME_SIZE, 0, (index + 1) * FRAME_SIZE, FRAME_SIZE))
        approved_bbox = approved_frame.getchannel("A").getbbox()
        if approved_bbox is None:
            raise ValueError(f"approved run frame {index} is empty")

        frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE))
        source_aligned = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE))
        source_aligned.alpha_composite(
            source_frame,
            (source_dx + LEFT_SAFETY_PX, source_dy),
        )

        # 只补旧腿层顶缘之上的同源像素，避免改写已认可腿部动作和颜色。
        splice_end_y = approved_bbox[1]
        if splice_end_y > SPLICE_TOP_Y:
            splice = source_aligned.crop((0, SPLICE_TOP_Y, FRAME_SIZE, splice_end_y))
            frame.alpha_composite(splice, (0, SPLICE_TOP_Y))

        # 全组统一右移，不做逐帧重新居中；自然根点轨迹保持原样。
        frame.alpha_composite(approved_frame, (LEFT_SAFETY_PX, 0))
        output.alpha_composite(frame, (index * FRAME_SIZE, 0))
        frames.append(frame)

    output.save(OUTPUT_RUN_LEGS)
    return frames


def build_preview(run_frames: list[Image.Image]) -> None:
    torso = Image.open(ASSETS / "gun_idle_torso.png").convert("RGBA")
    require_size(torso, (FRAME_SIZE, WALK_FRAME_HEIGHT), "gun torso")
    cell = 256
    sheet = Image.new("RGBA", (RUN_FRAME_COUNT * cell, cell), (38, 42, 48, 255))
    draw = ImageDraw.Draw(sheet)

    for index, legs in enumerate(run_frames):
        composite = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (38, 42, 48, 255))
        composite.alpha_composite(legs)
        torso_x = round(-RUN_BODY_BOB_X[index] * 0.5)
        torso_y = round(3 + RUN_BODY_BOB_Y[index])
        composite.alpha_composite(torso, (torso_x, torso_y))
        thumbnail = composite.resize((cell, cell), Image.Resampling.LANCZOS)
        sheet.alpha_composite(thumbnail, (index * cell, 0))
        draw.text((index * cell + 8, 8), f"run {index}", fill=(235, 235, 235, 255))

    sheet.save(PREVIEW)


def build_walk_torso(twist: dict, frame_index: int, angle: int) -> Image.Image:
    torso = Image.open(ASSETS / "gun_idle_torso.png").convert("RGBA")
    require_size(torso, (FRAME_SIZE, WALK_FRAME_HEIGHT), "gun torso")
    walk = twist["walkLegs"]
    bob_x = -(walk.get("bodyBobX", [0])[frame_index] or 0) * walk.get("bobXScale", 0.5)
    bob_y = (walk.get("bodyBobY", [0])[frame_index] or 0) * walk.get("bobScale", 1)
    dx = round((twist.get("torsoShiftX", 0) or 0) + bob_x)
    dy = round((twist.get("torsoShiftY", 0) or 0) + bob_y)
    layer = Image.new("RGBA", (FRAME_SIZE, WALK_FRAME_HEIGHT))
    layer.alpha_composite(torso, (dx, dy))
    pivot = (round(twist["pivotX"] + dx), round(twist["pivotY"] + dy))
    # PIL 正角为视觉逆时针；Canvas/Godot 风格屏幕坐标 Y 向下，运行时正角视觉顺时针。
    return layer.rotate(-angle, resample=Image.Resampling.BICUBIC, center=pivot)


def opaque_overlap(first: Image.Image, second: Image.Image, threshold: int = 128) -> int:
    a = first.getchannel("A").point(lambda value: 255 if value >= threshold else 0)
    b = second.getchannel("A").point(lambda value: 255 if value >= threshold else 0)
    return ImageChops.multiply(a, b).histogram()[255]


def build_walk_preview(walk_frames: list[Image.Image]) -> int:
    with PLAYER_ANIM_CONFIG.open("r", encoding="utf-8") as handle:
        twist = json.load(handle)["gun_idle"]["twist"]
    cell = 256
    sheet = Image.new(
        "RGBA",
        (len(WALK_PREVIEW_FRAMES) * cell, len(WALK_PREVIEW_ANGLES) * cell),
        (38, 42, 48, 255),
    )
    draw = ImageDraw.Draw(sheet)
    min_overlap = None
    for row, angle in enumerate(WALK_PREVIEW_ANGLES):
        for col, frame_index in enumerate(WALK_PREVIEW_FRAMES):
            legs = walk_frames[frame_index]
            torso = build_walk_torso(twist, frame_index, angle)
            overlap = opaque_overlap(legs, torso)
            min_overlap = overlap if min_overlap is None else min(min_overlap, overlap)
            composite = Image.new("RGBA", legs.size, (38, 42, 48, 255))
            composite.alpha_composite(legs)
            composite.alpha_composite(torso)
            thumbnail = composite.resize((cell, cell), Image.Resampling.LANCZOS)
            sheet.alpha_composite(thumbnail, (col * cell, row * cell))
            draw.text(
                (col * cell + 8, row * cell + 8),
                f"walk {frame_index} / {angle:+d} / overlap {overlap}",
                fill=(235, 235, 235, 255),
            )

    # 全 21 帧 × 三个审计角都必须存在强 alpha 接触；预览只抽取最易读的关键帧。
    for angle in WALK_PREVIEW_ANGLES:
        for frame_index, legs in enumerate(walk_frames):
            overlap = opaque_overlap(legs, build_walk_torso(twist, frame_index, angle))
            min_overlap = min(min_overlap, overlap)
            if overlap <= 0:
                raise ValueError(f"walk frame {frame_index} has no opaque torso contact at {angle:+d} degrees")
    sheet.save(WALK_PREVIEW)
    return min_overlap


def main() -> None:
    walk_frames = build_walk_legs()
    run_frames = build_run_legs()
    build_preview(run_frames)
    min_walk_overlap = build_walk_preview(walk_frames)
    print(f"wrote {OUTPUT_WALK_LEGS.relative_to(ROOT)}")
    print(f"wrote {OUTPUT_RUN_LEGS.relative_to(ROOT)}")
    print(f"wrote {PREVIEW.relative_to(ROOT)}")
    print(f"wrote {WALK_PREVIEW.relative_to(ROOT)} (min opaque overlap={min_walk_overlap}px)")


if __name__ == "__main__":
    main()
