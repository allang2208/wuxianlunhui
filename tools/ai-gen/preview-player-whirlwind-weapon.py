#!/usr/bin/env python3
"""Render the configured whirlwind body/weapon composite without launching Phaser.

This mirrors the special weapon branch closely enough to tune the grip anchor,
perspective squash and front/back crossover against the actual 23 body frames.
It is a visual tuning aid, not a runtime test.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FRAME_W = 512
FRAME_H = 516
PLAYER_BASE_SIZE = 144
PLAYER_FOOT_OFFSET_Y = 72
WEAPON_BASE_SIZE = 126 * 0.75
WEAPON_ORIGIN_X = 0.5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--body', type=Path, default=Path('assets/player/whirlwind.png'))
    parser.add_argument('--weapon', type=Path, default=Path('assets/weapons/1-rusty_sword_euip.png'))
    parser.add_argument('--player-config', type=Path, default=Path('data/player-anim-config.json'))
    parser.add_argument('--weapon-config', type=Path, default=Path('public/data/weapon-anim-config.json'))
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--preview-scale', type=float, default=2.0)
    return parser.parse_args()


def smoothstep(value: float) -> float:
    return value * value * (3.0 - 2.0 * value)


def frame_pose(index: int, cfg: dict) -> dict:
    frame_count = max(1, int(cfg.get('frameCount', 23)))
    lower_frames = max(0, int(cfg.get('lowerFrames', 0)))
    rise_frames = max(0, int(cfg.get('riseFrames', 0)))
    spin_frames = max(1, frame_count - lower_frames - rise_frames)
    theta = math.tau * index / frame_count
    low_amount = 0.0

    if lower_frames + rise_frames > 0 and spin_frames < frame_count:
        if index < lower_frames:
            t = 1.0 if lower_frames <= 1 else index / (lower_frames - 1)
            low_amount = smoothstep(t)
            theta = 0.0
        elif index < lower_frames + spin_frames:
            spin_index = index - lower_frames
            low_amount = 1.0
            theta = math.radians(float(cfg.get('spinPhaseDeg', 0))) + math.tau * spin_index / spin_frames
        else:
            rise_index = index - lower_frames - spin_frames
            t = 1.0 if rise_frames <= 1 else rise_index / (rise_frames - 1)
            low_amount = (1.0 - t) ** 3
            theta = 0.0

    screen_axis = math.cos(theta)
    depth_value = math.sin(theta)
    split_at = float(cfg.get('depthSplit', 0.2))
    perspective_min = float(cfg.get('perspectiveMin', 0.3))
    pose = {
        'x': float(cfg.get('orbitX', 19.21)) * screen_axis,
        'y': (
            float(cfg.get('centerOffsetY', -104.66))
            + float(cfg.get('bobY', 1.51)) * math.cos(theta * 2.0)
            + float(cfg.get('dropY', 0)) * low_amount
        ),
        'rotation': 90.0 if screen_axis >= 0 else -90.0,
        'perspective': perspective_min + (1.0 - perspective_min) * abs(screen_axis),
        'depth_value': depth_value,
        'phase': 'front' if depth_value > split_at else ('back' if depth_value < -split_at else 'split'),
        'front_from_tip': screen_axis >= 0,
        'low_amount': low_amount,
    }
    tracked_frames = cfg.get('frames')
    if isinstance(tracked_frames, list) and index < len(tracked_frames):
        tracked = tracked_frames[index]
        pose['x'] = float(tracked.get('offsetX', pose['x']))
        pose['y'] = float(tracked.get('offsetY', pose['y']))
        pose['rotation'] = float(tracked.get('rotation', pose['rotation']))
    return pose


def crop_texture(texture: Image.Image, start_ratio: float, end_ratio: float) -> Image.Image:
    result = texture.copy()
    alpha = result.getchannel('A')
    mask = Image.new('L', result.size, 0)
    draw = ImageDraw.Draw(mask)
    y0 = round(result.height * start_ratio)
    y1 = round(result.height * end_ratio)
    draw.rectangle((0, y0, result.width, max(y0, y1 - 1)), fill=255)
    result.putalpha(Image.composite(alpha, Image.new('L', result.size, 0), mask))
    return result


def render_weapon_layer(
    texture: Image.Image,
    anchor: tuple[float, float],
    display_size: tuple[float, float],
    rotation_deg: float,
    origin_y: float,
    canvas_size: tuple[int, int],
) -> Image.Image:
    width = max(1, round(display_size[0]))
    height = max(1, round(display_size[1]))
    resized = texture.resize((width, height), Image.Resampling.LANCZOS)
    pivot_x = width * WEAPON_ORIGIN_X
    pivot_y = height * origin_y
    pad = int(math.ceil(math.hypot(width, height) * 2.2))
    layer = Image.new('RGBA', (pad, pad), (0, 0, 0, 0))
    center = pad / 2.0
    layer.alpha_composite(resized, (round(center - pivot_x), round(center - pivot_y)))
    rotated = layer.rotate(-rotation_deg, resample=Image.Resampling.BICUBIC, center=(center, center))
    result = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
    result.alpha_composite(rotated, (round(anchor[0] - center), round(anchor[1] - center)))
    return result


def fit_body(frame: Image.Image, display_size: float) -> Image.Image:
    size = max(1, round(display_size))
    return frame.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    player_cfg = json.loads(args.player_config.read_text(encoding='utf-8'))['whirlwind']
    weapon_cfg = json.loads(args.weapon_config.read_text(encoding='utf-8'))['sword']['whirlwind']
    sheet = Image.open(args.body).convert('RGBA')
    weapon = Image.open(args.weapon).convert('RGBA')

    preview_scale = args.preview_scale
    canvas_size = (round(250 * preview_scale), round(230 * preview_scale))
    player_x = 125 * preview_scale
    player_y = 205 * preview_scale
    body_size = PLAYER_BASE_SIZE * float(player_cfg.get('displayScale', 1)) * preview_scale
    body_center = (player_x, player_y - PLAYER_FOOT_OFFSET_Y * preview_scale)
    origin_y = 0.5 + 40.0 / (WEAPON_BASE_SIZE * float(weapon_cfg.get('scale', 1.5)))
    weapon_width = WEAPON_BASE_SIZE * 0.63 * float(weapon_cfg.get('scale', 1.5))
    weapon_height = WEAPON_BASE_SIZE * float(weapon_cfg.get('scale', 1.5))
    frame_count = int(weapon_cfg.get('frameCount', 23))
    rendered: list[Image.Image] = []
    body_grid = Image.new('RGB', (FRAME_W * 5, FRAME_H * 5), (18, 21, 26))

    for index in range(frame_count):
        col = index % 5
        row = index // 5
        body = sheet.crop((col * FRAME_W, row * FRAME_H, (col + 1) * FRAME_W, (row + 1) * FRAME_H))
        grid_frame = Image.new('RGBA', (FRAME_W, FRAME_H), (24, 28, 34, 255))
        grid_frame.alpha_composite(body)
        grid_draw = ImageDraw.Draw(grid_frame)
        for grid_x in range(0, FRAME_W, 64):
            grid_draw.line((grid_x, 0, grid_x, FRAME_H), fill=(74, 90, 105, 96), width=1)
            grid_draw.text((grid_x + 2, 3), str(grid_x), fill=(140, 155, 170, 255), font=ImageFont.load_default())
        for grid_y in range(0, FRAME_H, 64):
            grid_draw.line((0, grid_y, FRAME_W, grid_y), fill=(74, 90, 105, 96), width=1)
            grid_draw.text((3, grid_y + 2), str(grid_y), fill=(140, 155, 170, 255), font=ImageFont.load_default())
        grid_draw.text((FRAME_W - 42, 3), f'f{index:02d}', fill=(255, 220, 90, 255), font=ImageFont.load_default())
        body_grid.paste(grid_frame.convert('RGB'), (col * FRAME_W, row * FRAME_H))
        body = fit_body(body, body_size)
        pose = frame_pose(index, weapon_cfg)
        anchor = (
            player_x + pose['x'] * preview_scale,
            player_y + pose['y'] * preview_scale,
        )
        display_size = (
            weapon_width * (0.72 + 0.28 * pose['perspective']) * preview_scale,
            weapon_height * pose['perspective'] * preview_scale,
        )

        empty = Image.new('RGBA', weapon.size, (0, 0, 0, 0))
        front_tex = empty
        back_tex = empty
        if pose['phase'] == 'front':
            front_tex = weapon
        elif pose['phase'] == 'back':
            back_tex = weapon
        else:
            clamped = max(-0.2, min(0.2, pose['depth_value']))
            front_ratio = (clamped + 0.2) / 0.4
            if pose['front_from_tip']:
                front_tex = crop_texture(weapon, 0.0, front_ratio)
                back_tex = crop_texture(weapon, front_ratio, 1.0)
            else:
                front_tex = crop_texture(weapon, 1.0 - front_ratio, 1.0)
                back_tex = crop_texture(weapon, 0.0, 1.0 - front_ratio)

        frame_canvas = Image.new('RGBA', canvas_size, (24, 28, 34, 255))
        back_layer = render_weapon_layer(back_tex, anchor, display_size, pose['rotation'], origin_y, canvas_size)
        frame_canvas.alpha_composite(back_layer)
        frame_canvas.alpha_composite(body, (round(body_center[0] - body.width / 2), round(body_center[1] - body.height / 2)))
        front_layer = render_weapon_layer(front_tex, anchor, display_size, pose['rotation'], origin_y, canvas_size)
        frame_canvas.alpha_composite(front_layer)

        draw = ImageDraw.Draw(frame_canvas)
        marker = max(2, round(2 * preview_scale))
        draw.ellipse((anchor[0] - marker, anchor[1] - marker, anchor[0] + marker, anchor[1] + marker), fill=(0, 220, 255, 255))
        draw.text((6, 5), f'f{index:02d} {pose["phase"]} p={pose["perspective"]:.2f}', fill=(230, 236, 244, 255), font=ImageFont.load_default())
        rendered_frame = frame_canvas.convert('RGB')
        rendered_frame.save(args.output_dir / f'frame_{index:02d}.png')
        rendered.append(rendered_frame)

    rendered[0].save(
        args.output_dir / 'whirlwind_weapon_preview.gif',
        save_all=True,
        append_images=rendered[1:],
        duration=round(800 * float(player_cfg.get('durationMul', 1)) / frame_count),
        loop=0,
        disposal=2,
    )

    thumb_w, thumb_h = 250, 230
    contact = Image.new('RGB', (thumb_w * 5, thumb_h * 5), (18, 21, 26))
    for index, frame in enumerate(rendered):
        thumb = frame.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        contact.paste(thumb, ((index % 5) * thumb_w, (index // 5) * thumb_h))
    contact.save(args.output_dir / 'whirlwind_weapon_contact.png')
    body_grid.save(args.output_dir / 'whirlwind_body_grid.png')
    (args.output_dir / 'whirlwind_weapon_pose.json').write_text(
        json.dumps([frame_pose(i, weapon_cfg) for i in range(frame_count)], indent=2),
        encoding='utf-8',
    )


if __name__ == '__main__':
    main()
