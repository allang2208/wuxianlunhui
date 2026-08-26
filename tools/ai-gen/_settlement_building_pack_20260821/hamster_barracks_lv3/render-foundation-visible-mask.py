from __future__ import annotations

import sys
from pathlib import Path

import bpy


FOUNDATION_NAME = "BarracksLV3_FieldFoundation"


def emission_material(name: str, value: float) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (value, value, value, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def main() -> None:
    if "--" not in sys.argv:
        raise SystemExit("usage: blender <blend> --python render-foundation-visible-mask.py -- <output.png>")
    output = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(output)
    scene.use_nodes = False
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    if scene.world is None:
        scene.world = bpy.data.worlds.new("FoundationMaskWorld")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    background.inputs["Strength"].default_value = 0.0

    white = emission_material("FoundationMaskWhite", 1.0)
    black = emission_material("FoundationMaskBlack", 0.0)
    foundation_found = False
    for obj in scene.objects:
        if obj.type != "MESH":
            continue
        obj.hide_render = False
        obj.data.materials.clear()
        if obj.name == FOUNDATION_NAME:
            obj.data.materials.append(white)
            foundation_found = True
        else:
            obj.data.materials.append(black)

    if not foundation_found:
        raise RuntimeError(f"missing foundation object: {FOUNDATION_NAME}")

    bpy.ops.render.render(write_still=True)
    print(f"foundation_visible_mask={output}")


if __name__ == "__main__":
    main()
