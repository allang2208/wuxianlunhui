"""Print model-space endpoint projection for the directional energy-vein master."""

from __future__ import annotations

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


def pixel(scene, camera, world: Vector) -> tuple[float, float]:
    ndc = world_to_camera_view(scene, camera, world)
    return ndc.x * scene.render.resolution_x, (1.0 - ndc.y) * scene.render.resolution_y


def main() -> None:
    scene = bpy.context.scene
    camera = scene.camera
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 512
    for mask in (1, 2, 4, 8):
        inspect_mask(scene, camera, mask)


def inspect_mask(scene, camera, mask: int) -> None:
    name = f"energy_vein_mask_{mask:02d}"
    collection = bpy.data.collections[name]
    root = bpy.data.objects[f"{name}_Root_44_8deg"]
    arranged = root.location.copy()
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    anchor = next(obj for obj in collection.all_objects if "BoundsAnchor" in obj.name)
    inverse = camera.matrix_world.inverted()
    camera_points = [inverse @ (anchor.matrix_world @ Vector(corner)) for corner in anchor.bound_box]
    min_x = min(point.x for point in camera_points)
    max_x = max(point.x for point in camera_points)
    min_y = min(point.y for point in camera_points)
    max_y = max(point.y for point in camera_points)
    camera.data.ortho_scale = max((max_y - min_y) / 0.975,
                                  (max_x - min_x) / 2.0 / 0.975)
    camera.data.shift_x = ((min_x + max_x) / 2) / camera.data.ortho_scale
    camera.data.shift_y = ((min_y + max_y) / 2) / camera.data.ortho_scale
    bpy.context.view_layer.update()
    print("mask", mask, "camera", camera.data.ortho_scale, camera.data.shift_x, camera.data.shift_y)
    for obj in collection.all_objects:
        if "SeamCap" in obj.name:
            print(obj.name, "local", tuple(obj.location), "world", tuple(obj.matrix_world.translation),
                  "pixel", pixel(scene, camera, obj.matrix_world.translation))
    root.location = arranged


if __name__ == "__main__":
    main()
