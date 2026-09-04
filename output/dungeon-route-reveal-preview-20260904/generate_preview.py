from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "dungeon-route-reveal-preview.gif"

WIDTH, HEIGHT = 960, 540
SCALE = 2
FRAME_MS = 50
CORE_MS = 1450

BG = (16, 20, 25, 255)
CHARCOAL = (23, 29, 35, 255)
GRAPHITE = (35, 43, 51, 255)
TEXT = (238, 243, 245, 255)
TEXT_MUTED = (156, 168, 177, 255)
TEXT_DIM = (107, 120, 130, 255)
LINE = (181, 205, 217, 46)
LINE_STRONG = (197, 219, 228, 97)
ACCENT = (196, 211, 218, 255)
CYAN = (116, 234, 255, 255)
CYAN_SOFT = (75, 210, 235, 255)
WARM_WHITE = (255, 247, 207, 255)


def rgba(color, alpha):
    return color[:3] + (max(0, min(255, int(alpha))),)


def font(size: int, bold: bool = False):
    filename = "msyhbd.ttc" if bold else "msyh.ttc"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / filename), size * SCALE)


FONT_TITLE = font(18, True)
FONT_BODY = font(14)
FONT_SMALL = font(12)
FONT_TINY = font(10)
FONT_NODE = font(19, True)


def scaled_point(point):
    return tuple(int(value * SCALE) for value in point)


def scaled_box(box):
    return tuple(int(value * SCALE) for value in box)


def line_length(points):
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def partial_line(points, distance):
    if distance <= 0:
        return [points[0]]
    result = [points[0]]
    remaining = distance
    for start, end in zip(points, points[1:]):
        segment = math.dist(start, end)
        if remaining >= segment:
            result.append(end)
            remaining -= segment
            continue
        ratio = remaining / max(segment, 0.0001)
        result.append((start[0] + (end[0] - start[0]) * ratio,
                       start[1] + (end[1] - start[1]) * ratio))
        break
    return result


def cubic_bezier_y(progress, x1=.16, y1=.8, x2=.24, y2=1.0):
    # CSS timing function: solve curve x for the requested wall-clock progress.
    lo, hi = 0.0, 1.0
    for _ in range(14):
        t = (lo + hi) / 2
        mt = 1 - t
        x = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3
        if x < progress:
            lo = t
        else:
            hi = t
    t = (lo + hi) / 2
    mt = 1 - t
    return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3


def reveal_style(elapsed_ms):
    p = max(0.0, min(1.0, elapsed_ms / 900.0))
    eased = cubic_bezier_y(p)
    if eased <= .42:
        q = eased / .42
        brightness = .72 + (.78 * q)
        ring = 7 * q
        glow_alpha = 184 * q
    else:
        q = (eased - .42) / .58
        brightness = 1.5 - .5 * q
        ring = 7 - 5 * q
        glow_alpha = 184 - 153 * q
    return brightness, max(0.0, ring), max(0.0, glow_alpha)


ORIGIN = (190, 300)
PATHS = [
    [(190, 300), (315, 300), (410, 210), (535, 210)],
    [(190, 300), (315, 300), (450, 300), (600, 300), (720, 250)],
    [(190, 300), (315, 300), (420, 390), (575, 390), (765, 430)],
]
TARGETS = [
    ((535, 210), "07", "坍塌侧室", "补给线索"),
    ((720, 250), "08", "旧军械库", "战斗线索"),
    ((765, 430), "09", "矿脉深处", "远端线索"),
]
PATH_LENGTHS = [line_length(path) for path in PATHS]
MAX_LENGTH = max(PATH_LENGTHS)


def draw_text(draw, xy, value, chosen_font, fill, anchor=None):
    draw.text(scaled_point(xy), value, font=chosen_font, fill=fill, anchor=anchor)


def draw_glow_line(base, points, color, width, blur, alpha):
    if len(points) < 2:
        return
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.line([scaled_point(p) for p in points], fill=rgba(color, alpha),
            width=width * SCALE, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(blur * SCALE))
    base.alpha_composite(glow)


def draw_base_route(draw, path):
    pts = [scaled_point(p) for p in path]
    draw.line(pts, fill=(72, 88, 98, 185), width=3 * SCALE, joint="curve")
    draw.line(pts, fill=(153, 175, 184, 110), width=1 * SCALE, joint="curve")
    for point in path[1:-1]:
        x, y = scaled_point(point)
        r = 3 * SCALE
        draw.ellipse((x-r, y-r, x+r, y+r), fill=(104, 121, 130, 235))


def draw_node(base, point, number, title, subtitle, *, current=False, reveal_ms=None, hidden=False):
    x, y = point
    brightness, ring, glow_alpha = (1.0, 0.0, 0.0)
    if reveal_ms is not None:
        brightness, ring, glow_alpha = reveal_style(reveal_ms)

    if glow_alpha > 0:
        glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        rr = (31 + ring) * SCALE
        cx, cy = scaled_point(point)
        gd.rounded_rectangle((cx-rr, cy-rr, cx+rr, cy+rr), radius=10*SCALE,
                             outline=rgba(CYAN, glow_alpha), width=max(2, int(3*SCALE)))
        glow = glow.filter(ImageFilter.GaussianBlur(9*SCALE))
        base.alpha_composite(glow)

    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    cx, cy = scaled_point(point)
    half = 24 * SCALE
    outline = ACCENT if current else LINE_STRONG
    fill = (38, 47, 55, 255) if current else CHARCOAL
    ld.rounded_rectangle((cx-half, cy-half, cx+half, cy+half), radius=6*SCALE,
                         fill=fill, outline=outline, width=(2 if current else 1)*SCALE)
    if current:
        ld.rounded_rectangle((cx-half-4*SCALE, cy-half-4*SCALE,
                              cx+half+4*SCALE, cy+half+4*SCALE), radius=9*SCALE,
                             outline=(142, 166, 178, 80), width=2*SCALE)

    # Compact room glyph: unreached targets retain only the unknown-room marker.
    glyph = (218, 229, 234, 235) if current else (145, 159, 168, 230)
    if hidden:
        ld.text((cx, cy-1*SCALE), "?", font=FONT_NODE, fill=TEXT_DIM, anchor="mm")
    else:
        g = 12 * SCALE
        w = 2 * SCALE
        ld.line((cx-g, cy-g, cx-3*SCALE, cy-g), fill=glyph, width=w)
        ld.line((cx-g, cy-g, cx-g, cy-3*SCALE), fill=glyph, width=w)
        ld.line((cx+g, cy-g, cx+3*SCALE, cy-g), fill=glyph, width=w)
        ld.line((cx+g, cy-g, cx+g, cy-3*SCALE), fill=glyph, width=w)
        ld.line((cx-g, cy+g, cx-3*SCALE, cy+g), fill=glyph, width=w)
        ld.line((cx-g, cy+g, cx-g, cy+3*SCALE), fill=glyph, width=w)
        ld.line((cx+g, cy+g, cx+3*SCALE, cy+g), fill=glyph, width=w)
        ld.line((cx+g, cy+g, cx+g, cy+3*SCALE), fill=glyph, width=w)
        d = 5 * SCALE
        ld.polygon([(cx, cy-d), (cx+d, cy), (cx, cy+d), (cx-d, cy)], outline=glyph)

    if brightness != 1.0:
        alpha = layer.getchannel("A")
        rgb = Image.new("RGB", layer.size, (0, 0, 0))
        rgb.paste(layer.convert("RGB"), mask=alpha)
        rgb = ImageEnhance.Brightness(rgb).enhance(brightness)
        layer = Image.merge("RGBA", (*rgb.split(), alpha))
    base.alpha_composite(layer)

    d = ImageDraw.Draw(base)
    badge = scaled_box((x-31, y-32, x-8, y-15))
    d.rounded_rectangle(badge, radius=4*SCALE, fill=BG, outline=LINE, width=SCALE)
    draw_text(d, (x-19.5, y-23.5), number, FONT_TINY, TEXT_MUTED, "mm")
    draw_text(d, (x, y+38), title, FONT_SMALL, TEXT if current else TEXT_MUTED, "mm")
    draw_text(d, (x, y+57), subtitle, FONT_TINY, (112, 203, 219, 235) if reveal_ms is not None else TEXT_DIM, "mm")


def render(elapsed_ms):
    canvas = Image.new("RGBA", (WIDTH*SCALE, HEIGHT*SCALE), BG)
    draw = ImageDraw.Draw(canvas)

    # Cold-steel panel shell.
    draw.rounded_rectangle(scaled_box((20, 18, 940, 522)), radius=10*SCALE,
                           fill=(9, 12, 15, 255), outline=LINE_STRONG, width=SCALE)
    draw.rectangle(scaled_box((21, 19, 939, 74)), fill=(22, 28, 34, 255))
    draw.line((40*SCALE, 74*SCALE, 920*SCALE, 74*SCALE), fill=LINE, width=SCALE)
    draw.rectangle(scaled_box((40, 92, 920, 476)), fill=BG, outline=LINE, width=SCALE)

    # Subtle map grid.
    for x in range(55, 921, 32):
        draw.line((x*SCALE, 93*SCALE, x*SCALE, 475*SCALE), fill=(108, 129, 139, 13), width=SCALE)
    for y in range(108, 476, 32):
        draw.line((41*SCALE, y*SCALE, 919*SCALE, y*SCALE), fill=(108, 129, 139, 13), width=SCALE)

    draw.rectangle(scaled_box((42, 20, 45, 72)), fill=(142, 166, 178, 255))
    draw_text(draw, (58, 34), "路线选择", FONT_TITLE, TEXT)
    draw_text(draw, (58, 59), "废弃矿洞 · 区域 2 / 4", FONT_SMALL, TEXT_MUTED, "lm")
    draw_text(draw, (902, 46), "线索：前方 3 个房间", FONT_SMALL, ACCENT, "rm")

    for path in PATHS:
        draw_base_route(draw, path)

    # Nearby unrelated rooms make the preview read as the actual route map.
    draw_node(canvas, (100, 170), "04", "废轨入口", "已探索")
    draw_node(canvas, ORIGIN, "06", "当前位置", "线索起点", current=True)

    # Each room remains unknown until the pulse head actually reaches that path endpoint.
    for path, path_length, (point, number, title, subtitle) in zip(PATHS, PATH_LENGTHS, TARGETS):
        arrival_progress = 1 - math.sqrt(max(0, 1 - path_length / MAX_LENGTH))
        arrival_ms = CORE_MS * arrival_progress
        arrived = elapsed_ms >= arrival_ms
        if arrived:
            draw_node(canvas, point, number, title, subtitle,
                      reveal_ms=max(0, min(elapsed_ms - arrival_ms, 900)))
        else:
            draw_node(canvas, point, number, "未侦察房间", "内容未揭示", hidden=True)

    if 0 <= elapsed_ms <= CORE_MS:
        progress = max(0.0, min(1.0, elapsed_ms / CORE_MS))
        travel_distance = MAX_LENGTH * (1 - (1 - progress) ** 2)
        for path, total in zip(PATHS, PATH_LENGTHS):
            visible = partial_line(path, min(total, travel_distance))
            if len(visible) >= 2:
                draw_glow_line(canvas, visible, CYAN, 7, 7, 170)
                pd = ImageDraw.Draw(canvas)
                pd.line([scaled_point(p) for p in visible], fill=(75, 210, 235, 72),
                        width=8*SCALE, joint="curve")
                draw_glow_line(canvas, visible, (239, 252, 255, 255), 2, 2, 180)
                pd.line([scaled_point(p) for p in visible], fill=(239, 252, 255, 240),
                        width=2*SCALE, joint="curve")

            if travel_distance < total:
                head = visible[-1]
                glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
                gd = ImageDraw.Draw(glow)
                hx, hy = scaled_point(head)
                gd.ellipse((hx-8*SCALE, hy-8*SCALE, hx+8*SCALE, hy+8*SCALE), fill=rgba(CYAN, 210))
                glow = glow.filter(ImageFilter.GaussianBlur(8*SCALE))
                canvas.alpha_composite(glow)
                hd = ImageDraw.Draw(canvas)
                r = 4.5*SCALE
                hd.ellipse((hx-r, hy-r, hx+r, hy+r), fill=WARM_WHITE)
            else:
                ring_progress = max(0.0, min(1.0, (travel_distance-total+1)/90.0))
                radius = (25 + ring_progress*24) * SCALE
                alpha = 204 * (1-ring_progress)
                if alpha > 0:
                    target = path[-1]
                    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
                    gd = ImageDraw.Draw(glow)
                    tx, ty = scaled_point(target)
                    gd.ellipse((tx-radius, ty-radius, tx+radius, ty+radius),
                               outline=rgba((142, 238, 255, 255), alpha), width=2*SCALE)
                    glow = glow.filter(ImageFilter.GaussianBlur(5*SCALE))
                    canvas.alpha_composite(glow)
                    rd = ImageDraw.Draw(canvas)
                    rd.ellipse((tx-radius, ty-radius, tx+radius, ty+radius),
                               outline=rgba((142, 238, 255, 255), alpha), width=2*SCALE)

    draw = ImageDraw.Draw(canvas)
    hint = "获得线索，等待脉冲传导" if elapsed_ms < 0 else (
        "线索脉冲正在从当前位置沿路线扩散" if elapsed_ms < CORE_MS else "更远房间线索已逐个揭示")
    hint_color = (173, 233, 242, 255) if 0 <= elapsed_ms < CORE_MS else TEXT_MUTED
    draw_text(draw, (48, 494), hint, FONT_SMALL, hint_color, "lm")
    draw_text(draw, (912, 494), "核心传播 1.45s · 实现参数预览", FONT_TINY, TEXT_DIM, "rm")

    return canvas.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS).convert("P", palette=Image.Palette.ADAPTIVE, colors=256)


def main():
    times = ([-1] * 7
             + list(range(0, CORE_MS + 1, FRAME_MS))
             + list(range(CORE_MS + FRAME_MS, CORE_MS + 901, FRAME_MS))
             + [CORE_MS + 900] * 10)
    frames = [render(t) for t in times]
    frames[0].save(
        OUTPUT,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=False,
        disposal=2,
    )
    print(f"wrote {OUTPUT} ({len(frames)} frames, {WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
