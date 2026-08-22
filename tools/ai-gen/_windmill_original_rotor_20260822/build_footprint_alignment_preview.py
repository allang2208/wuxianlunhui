from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[2]
BODY_PATH = PROJECT_ROOT / "assets" / "terrain" / "wheat_windmill_body.png"
ROTOR_PATH = PROJECT_ROOT / "assets" / "terrain" / "wheat_windmill_rotor.png"
OUTPUT_PATH = ROOT / "windmill_footprint_alignment_preview.png"

CANVAS_SIZE = (700, 600)
ENTITY_FRONT = (350.0, 500.0)
BODY_DISPLAY = (276, 340)
ROTOR_DISPLAY = (428, 428)
AUTO_VISUAL_OFFSET_X = 14.5
AUTO_FOOT_OFFSET_Y = 169.0
ANCHOR_ADJUST = (-5.0, 5.0)
ROTOR_OFFSET = (50.1328125, -27.625)


def centered_top_left(center, size):
    return (
        round(center[0] - size[0] / 2),
        round(center[1] - size[1] / 2),
    )


def main() -> None:
    canvas = Image.new("RGBA", CANVAS_SIZE, (24, 27, 30, 255))
    draw = ImageDraw.Draw(canvas, "RGBA")
    footprint = [
        (ENTITY_FRONT[0], ENTITY_FRONT[1] - 128),
        (ENTITY_FRONT[0] + 128, ENTITY_FRONT[1] - 64),
        ENTITY_FRONT,
        (ENTITY_FRONT[0] - 128, ENTITY_FRONT[1] - 64),
    ]
    draw.polygon(footprint, fill=(50, 180, 230, 50))

    body_center = (
        ENTITY_FRONT[0] + AUTO_VISUAL_OFFSET_X + ANCHOR_ADJUST[0],
        ENTITY_FRONT[1] - (AUTO_FOOT_OFFSET_Y + ANCHOR_ADJUST[1]),
    )
    body = Image.open(BODY_PATH).convert("RGBA").resize(BODY_DISPLAY, Image.Resampling.LANCZOS)
    canvas.alpha_composite(body, centered_top_left(body_center, BODY_DISPLAY))

    rotor_sheet = Image.open(ROTOR_PATH).convert("RGBA")
    rotor = rotor_sheet.crop((0, 0, 768, 768)).resize(ROTOR_DISPLAY, Image.Resampling.LANCZOS)
    rotor_center = (
        body_center[0] + ROTOR_OFFSET[0],
        body_center[1] + ROTOR_OFFSET[1],
    )
    canvas.alpha_composite(rotor, centered_top_left(rotor_center, ROTOR_DISPLAY))

    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.line(footprint + [footprint[0]], fill=(60, 220, 255, 255), width=3)
    front_x, front_y = ENTITY_FRONT
    draw.ellipse((front_x - 6, front_y - 6, front_x + 6, front_y + 6), fill=(255, 95, 70, 255))
    draw.line((front_x - 12, front_y, front_x + 12, front_y), fill=(255, 255, 255, 220), width=2)
    draw.line((front_x, front_y - 12, front_x, front_y + 12), fill=(255, 255, 255, 220), width=2)
    draw.text((18, 18), "cyan: logical 2x2 footprint | red: logical front vertex", fill=(235, 240, 245, 255))
    draw.text((18, 42), "final visual anchor: left 5px / up 5px", fill=(235, 240, 245, 255))
    canvas.save(OUTPUT_PATH, optimize=True)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
