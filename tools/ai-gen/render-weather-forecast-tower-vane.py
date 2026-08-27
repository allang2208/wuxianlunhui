#!/usr/bin/env python3
"""Render the weather tower's wind instruments as a transparent overlay loop.

Run inside Blender with the authored weather-forecast-tower .blend already open.
Only the moving wind-vane and anemometer arms are rendered; the mast, hubs and
building remain in the static runtime body so the overlay naturally sits behind
the bearing hardware.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy


def script_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def moving_objects(prefix: str, excluded_suffixes: tuple[str, ...]) -> list[bpy.types.Object]:
    return [
        obj for obj in bpy.data.objects
        if obj.name.startswith(prefix)
        and not obj.name.endswith(excluded_suffixes)
    ]


def make_pivot(name: str, root: bpy.types.Object, location: tuple[float, float, float],
               objects: list[bpy.types.Object]) -> bpy.types.Object:
    pivot = bpy.data.objects.new(name, None)
    pivot.parent = root
    pivot.location = location
    bpy.context.scene.collection.objects.link(pivot)
    for obj in objects:
        local_location = obj.location.copy()
        obj.parent = pivot
        obj.location = local_location - pivot.location
    return pivot


def main() -> None:
    args = script_args()
    if len(args) != 2:
        raise SystemExit("usage: <output-dir> <frame-count>")
    output_dir = Path(args[0]).resolve()
    frame_count = max(8, int(args[1]))
    output_dir.mkdir(parents=True, exist_ok=True)

    root = bpy.data.objects.get("WEATHER_FORECAST_TOWER_ROOT_ROT_Z_44_8")
    if root is None:
        raise SystemExit("weather tower root missing")

    vane = moving_objects("WeatherTower_WindVane_", ())
    anemometer = moving_objects(
        "WeatherTower_Anemometer_",
        ("_Axle", "_Hub"),
    )
    if not vane or not anemometer:
        raise SystemExit("weather tower moving instrument objects missing")

    visible = set(vane + anemometer)
    for obj in bpy.data.objects:
        if obj.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            obj.hide_render = obj not in visible

    vane_pivot = make_pivot("WeatherTower_WindVane_AnimationPivot", root, (0, 30, 542), vane)
    anemometer_pivot = make_pivot(
        "WeatherTower_Anemometer_AnimationPivot", root, (0, 30, 552), anemometer
    )

    scene = bpy.context.scene
    scene.render.film_transparent = True
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"

    for frame in range(frame_count):
        phase = frame / frame_count
        # One calm direction sweep for the vane and two cup rotations per loop.
        vane_pivot.rotation_euler.z = math.tau * phase
        anemometer_pivot.rotation_euler.z = math.tau * phase * 2.0
        scene.render.filepath = str(output_dir / f"vane_{frame:03d}.png")
        bpy.ops.render.render(write_still=True)
        print(scene.render.filepath, flush=True)


if __name__ == "__main__":
    main()
