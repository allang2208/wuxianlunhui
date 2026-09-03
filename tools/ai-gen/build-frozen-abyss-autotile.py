#!/usr/bin/env python3
"""Build the frozen-dungeon abyss 16-mask autotile blockout in Blender.

Each frame represents one 128x64 logical abyss cell.  The four mask bits mean
that another abyss cell exists across +u, +v, -u or -v respectively.  Missing
neighbors receive a modeled ice rim and vertical blue-ice break; connected
edges remain open so adjacent cells join without rotation, stretching or a
lighting-direction change.

This script intentionally stops at the approval blockout.  It produces a
single editable .blend, a 4x4 approval contact render, a structural depth
render and a manifest.  Final runtime frames/PBR refinement are a later,
user-approved stage.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "ai-gen" / "_frozen_abyss_autotile_20260829"
PREVIEW = OUT / "previews" / "frozen_abyss_autotile_approval_preview.png"
DEPTH = OUT / "depth" / "frozen_abyss_autotile_depth.png"
SEAM_PROOF = OUT / "previews" / "frozen_abyss_autotile_seam_proof.png"
SEAM_DEPTH = OUT / "depth" / "frozen_abyss_autotile_seam_depth.png"
STYLE_PREVIEW = OUT / "previews" / "frozen_abyss_style_model_preview.png"
STYLE_DEPTH = OUT / "depth" / "frozen_abyss_style_depth.png"
STYLE_FLOOR_PREVIEW = OUT / "previews" / "frozen_abyss_style_floor_model_preview.png"
STYLE_FLOOR_DEPTH = OUT / "depth" / "frozen_abyss_style_floor_depth.png"
BLEND = OUT / "frozen_abyss_autotile_blockout.blend"
MANIFEST = OUT / "frozen_abyss_autotile_manifest.json"
STYLE_PROMPT = ROOT / "tools" / "ai-gen" / "prompts" / "frozen-abyss-style.md"
PUBLIC_STYLE = ROOT / "tools" / "ai-gen" / "prompts" / "world122-building-style.md"

GRID_CELL = (128, 64)
MASK_DIRECTIONS = ("+u", "+v", "-u", "-v")
TILE_SIZE = 2.0
TILE_SPACING = 3.25
RIM_WIDTH = 0.24
ICE_TOP_Z = 0.08
PIT_Z = -0.62
CLIFF_BOTTOM_Z = -0.58
ROOT_ROTATION_Z = 44.8
SEAM_OVERLAP = 0.0


def rgba(hex_color: str, alpha: float = 1.0):
    value = hex_color.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (alpha,)


def material(name: str, color: str, roughness: float = 0.85, metallic: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = rgba(color)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def move_to_collection(obj, collection):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)


def cube(name: str, location, dimensions, mat, collection, bevel: float = 0.0,
         parent=None):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Frozen chipped bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    obj.data.materials.append(mat)
    move_to_collection(obj, collection)
    return obj


def prism(name: str, polygon, z_bottom: float, z_top: float, mat, collection,
          parent=None, bevel: float = 0.0, open_end_edges=()):
    """Editable horizontal prism used for a fractured, non-masonry snow lip."""
    count = len(polygon)
    vertices = [(x, y, z_bottom) for x, y in polygon]
    vertices.extend((x, y, z_top) for x, y in polygon)
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        if index in open_end_edges:
            continue
        nxt = (index + 1) % count
        faces.append((index, nxt, nxt + count, index + count))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.parent = parent
    collection.objects.link(obj)
    if bevel > 0:
        modifier = obj.modifiers.new("Natural edge soften", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def cliff_band(name: str, bit: int, center, mat, collection, parent=None):
    """Uneven ice break with fixed seam endpoints and believable slab thickness."""
    cx, cy = center
    half = TILE_SIZE / 2
    along = (-half - SEAM_OVERLAP, -0.52, 0.0, 0.52, half + SEAM_OVERLAP)
    top = (0.035, 0.065, 0.045, 0.075, 0.035)
    bottom = (-0.50, -0.62, -0.55, -0.66, -0.50)
    normal = ((1, 0), (0, 1), (-1, 0), (0, -1))[bit]
    tangent = ((0, 1), (1, 0), (0, 1), (1, 0))[bit]
    outer_distance = half - 0.055
    inner_distance = half - RIM_WIDTH * 0.82

    def point(distance, value, z):
        return (
            cx + normal[0] * distance + tangent[0] * value,
            cy + normal[1] * distance + tangent[1] * value,
            z,
        )

    outer_top = [point(outer_distance, value, top[i]) for i, value in enumerate(along)]
    outer_bottom = [point(outer_distance, value, bottom[i]) for i, value in enumerate(along)]
    inner_top = [point(inner_distance, value, top[i] + 0.015) for i, value in enumerate(along)]
    inner_bottom = [point(inner_distance, value, bottom[i] + 0.05) for i, value in enumerate(along)]
    vertices = outer_top + outer_bottom + inner_top + inner_bottom
    count = len(along)
    ot, ob, it, ib = 0, count, count * 2, count * 3
    faces = []
    for i in range(count - 1):
        faces.extend([
            (ot + i, ot + i + 1, ob + i + 1, ob + i),
            (it + i + 1, it + i, ib + i, ib + i + 1),
            (ot + i, it + i, it + i + 1, ot + i + 1),
            (ob + i + 1, ib + i + 1, ib + i, ob + i),
        ])
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.parent = parent
    collection.objects.link(obj)
    return obj


def fractured_chunk(name: str, location, dimensions, mat, collection, parent, rotation_z=0.0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = rotation_z
    obj.data.materials.append(mat)
    move_to_collection(obj, collection)
    return obj


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 55
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.25

    world = scene.world or bpy.data.worlds.new("World122_Neutral_World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.18, 0.19, 0.21, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.78

    camera_distance = 24.0
    elevation = math.radians(30.0)
    bpy.ops.object.camera_add(location=(
        0.0,
        -camera_distance * math.cos(elevation),
        camera_distance * math.sin(elevation),
    ))
    camera = bpy.context.object
    camera.name = "World122_Ortho_Camera_30deg"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 18.0
    camera.rotation_euler = (math.radians(60.0), 0, 0)
    scene.camera = camera

    bpy.ops.object.light_add(type="SUN")
    key = bpy.context.object
    key.name = "Key_Sun"
    key.data.energy = 1.8
    key.data.angle = math.radians(20)
    key.rotation_euler = (math.radians(42), 0, math.radians(-38))

    bpy.ops.object.light_add(type="AREA", location=(-4.8, -6.2, 7.2))
    fill = bpy.context.object
    fill.name = "Soft_Fill"
    fill.data.energy = 680
    fill.data.shape = "DISK"
    fill.data.size = 6.5
    look_at(fill, (0, 0, 0.2))

    return scene


def add_rim(mask: int, bit: int, center, collection, mats, root):
    cx, cy = center
    half = TILE_SIZE / 2
    normal = ((1, 0), (0, 1), (-1, 0), (0, -1))[bit]
    tangent = ((0, 1), (1, 0), (0, 1), (1, 0))[bit]
    along_values = (
        -half - SEAM_OVERLAP, -0.52, 0.0, 0.52, half + SEAM_OVERLAP,
    )
    outer_jag = (0.0, 0.035, -0.018, 0.028, 0.0)
    inner_jag = (0.0, -0.025, 0.018, -0.030, 0.0)

    def edge_point(distance, along):
        return (
            cx + normal[0] * distance + tangent[0] * along,
            cy + normal[1] * distance + tangent[1] * along,
        )

    outer = [edge_point(half + outer_jag[i], value)
             for i, value in enumerate(along_values)]
    inner = [edge_point(half - RIM_WIDTH + inner_jag[i], value)
             for i, value in enumerate(along_values)]
    lip_polygon = outer + list(reversed(inner))
    prism(f"Mask{mask:02d}_{MASK_DIRECTIONS[bit]}_CompactedSnowLip",
          lip_polygon, ICE_TOP_Z - 0.075, ICE_TOP_Z + 0.035,
          mats["snow"], collection, root, bevel=0.0,
          open_end_edges=(len(along_values) - 1, len(lip_polygon) - 1))
    cliff_band(f"Mask{mask:02d}_{MASK_DIRECTIONS[bit]}_StratifiedIceBreak",
               bit, center, mats["cliff"], collection, root)

    # One sparse fractured chunk replaces the previous regular crenellation-like teeth.
    chunk_along = (-0.22, 0.26, -0.30, 0.18)[bit]
    chunk_distance = half - RIM_WIDTH * 0.52
    chunk_location = (
        cx + normal[0] * chunk_distance + tangent[0] * chunk_along,
        cy + normal[1] * chunk_distance + tangent[1] * chunk_along,
        ICE_TOP_Z + 0.065,
    )
    fractured_chunk(
        f"Mask{mask:02d}_{MASK_DIRECTIONS[bit]}_FracturedSnowChunk",
        chunk_location, (0.25, 0.17, 0.12), mats["frost"], collection, root,
        rotation_z=0.18 * (bit - 1.5))


def add_label(mask: int, center, collection, mat, root):
    cx, cy = center
    bpy.ops.object.text_add(location=(cx, cy - 1.34, -0.02))
    label = bpy.context.object
    label.name = f"Mask{mask:02d}_Label"
    label.parent = root
    label["approval_only"] = True
    label.data.body = f"{mask:02d}"
    label.data.align_x = "CENTER"
    label.data.align_y = "CENTER"
    label.data.size = 0.30
    label.data.extrude = 0.012
    label.data.bevel_depth = 0.005
    label.data.materials.append(mat)
    move_to_collection(label, collection)


def build_mask(mask: int, center, mats, root, *, label=True, prefix="FrozenAbyss"):
    collection = bpy.data.collections.new(f"{prefix}_Mask_{mask:02d}")
    bpy.context.scene.collection.children.link(collection)
    cx, cy = center
    # Slight overdraw and no bevel prevent an internal grid line between connected cells.
    cube(f"Mask{mask:02d}_Void", (cx, cy, PIT_Z),
         (TILE_SIZE + 0.025, TILE_SIZE + 0.025, 0.055),
         mats["void"], collection, bevel=0.0, parent=root)
    # The four bits mean connected abyss neighbors.  Only missing neighbors get a rim.
    for bit in range(4):
        if (mask & (1 << bit)) == 0:
            add_rim(mask, bit, center, collection, mats, root)
    if label:
        add_label(mask, center, collection, mats["label"], root)


def render_depth(scene, output_path):
    approval_only = [obj for obj in scene.objects if obj.get("approval_only")]
    old_visibility = {obj.name: obj.hide_render for obj in approval_only}
    for obj in approval_only:
        obj.hide_render = True
    scene.view_layers["ViewLayer"].use_pass_z = True
    tree = bpy.data.node_groups.new("FrozenAbyssDepthComp", "CompositorNodeTree")
    scene.compositing_node_group = tree
    nodes = tree.nodes
    links = tree.links
    layers = nodes.new("CompositorNodeRLayers")
    map_range = nodes.new("ShaderNodeMapRange")
    map_range.inputs["From Min"].default_value = 17.0
    map_range.inputs["From Max"].default_value = 31.0
    map_range.inputs["To Min"].default_value = 1.0
    map_range.inputs["To Max"].default_value = 0.0
    map_range.clamp = True
    multiply = nodes.new("ShaderNodeMath")
    multiply.operation = "MULTIPLY"
    output = nodes.new("NodeGroupOutput")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    links.new(layers.outputs["Depth"], map_range.inputs["Value"])
    links.new(map_range.outputs["Result"], multiply.inputs[0])
    links.new(layers.outputs["Alpha"], multiply.inputs[1])
    links.new(multiply.outputs[0], output.inputs["Image"])
    scene.render.image_settings.color_mode = "BW"
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)
    scene.compositing_node_group = None
    bpy.data.node_groups.remove(tree)
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(PREVIEW)
    for obj in approval_only:
        obj.hide_render = old_visibility[obj.name]


def render_seam_proof(scene, mats, overview_root):
    """Assemble real neighbor masks into one connected irregular abyss."""
    def set_tree_hidden(root, hidden):
        root.hide_render = hidden
        for child in root.children_recursive:
            child.hide_render = hidden

    set_tree_hidden(overview_root, True)
    proof_root = bpy.data.objects.new("FrozenAbyss_SeamProof_ROOT", None)
    proof_root.rotation_euler.z = math.radians(ROOT_ROTATION_Z)
    scene.collection.objects.link(proof_root)

    proof_collection = bpy.data.collections.new("FrozenAbyss_SeamProof")
    scene.collection.children.link(proof_collection)
    board = cube("SeamProof_Backdrop", (0.8, 1.0, -0.78), (10.5, 9.5, 0.08),
                 mats["board"], proof_collection, bevel=0.10, parent=proof_root)
    board["approval_only"] = True

    cells = {
        (-1, 1), (0, 0), (0, 1), (0, 2),
        (1, 0), (1, 1), (2, 0), (2, -1),
    }
    steps = ((1, 0), (0, 1), (-1, 0), (0, -1))
    for u, v in sorted(cells):
        mask = 0
        for bit, (du, dv) in enumerate(steps):
            if (u + du, v + dv) in cells:
                mask |= 1 << bit
        build_mask(mask, (u * TILE_SIZE, v * TILE_SIZE), mats, proof_root,
                   label=False, prefix=f"SeamProof_{u:+d}_{v:+d}")

    scene.camera.data.ortho_scale = 10.8
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1000
    scene.render.filepath = str(SEAM_PROOF)
    bpy.ops.render.render(write_still=True)
    render_depth(scene, SEAM_DEPTH)

    set_tree_hidden(proof_root, True)
    set_tree_hidden(overview_root, False)
    scene.camera.data.ortho_scale = 18.0
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1200
    scene.render.filepath = str(PREVIEW)
    return proof_root


def render_style_reference(scene, mats, overview_root):
    """Render a pit cut into a floor that continues beyond every image edge."""
    def set_tree_hidden(root, hidden):
        root.hide_render = hidden
        for child in root.children_recursive:
            child.hide_render = hidden

    set_tree_hidden(overview_root, True)
    style_root = bpy.data.objects.new("FrozenAbyss_StyleReference_ROOT", None)
    style_root.rotation_euler.z = math.radians(ROOT_ROTATION_Z)
    scene.collection.objects.link(style_root)
    collection = bpy.data.collections.new("FrozenAbyss_StyleReference")
    scene.collection.children.link(collection)
    build_mask(0, (0, 0), mats, style_root, label=False, prefix="StyleReference")

    # The first isolated reference was consistently interpreted by the image
    # model as a raised square block.  Four overlapping floor fields continue
    # beyond the camera crop, leaving only the authored inner collapse visible.
    extent = 7.0
    half = TILE_SIZE / 2
    overlap = 0.08
    floor_inner = half - overlap
    floor_z = ICE_TOP_Z - 0.02
    floor_h = 0.11
    side_span = extent - floor_inner
    side_center = (extent + floor_inner) / 2
    cube("StyleFloor_West", (-side_center, 0, floor_z),
         (side_span, extent * 2, floor_h), mats["snow"], collection,
         bevel=0.0, parent=style_root)
    cube("StyleFloor_East", (side_center, 0, floor_z),
         (side_span, extent * 2, floor_h), mats["snow"], collection,
         bevel=0.0, parent=style_root)
    cube("StyleFloor_North", (0, side_center, floor_z),
         (extent * 2, side_span, floor_h), mats["snow"], collection,
         bevel=0.0, parent=style_root)
    cube("StyleFloor_South", (0, -side_center, floor_z),
         (extent * 2, side_span, floor_h), mats["snow"], collection,
         bevel=0.0, parent=style_root)

    scene.camera.data.ortho_scale = 4.2
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.filepath = str(STYLE_FLOOR_PREVIEW)
    bpy.ops.render.render(write_still=True)
    render_depth(scene, STYLE_FLOOR_DEPTH)

    set_tree_hidden(style_root, True)
    set_tree_hidden(overview_root, False)
    scene.camera.data.ortho_scale = 18.0
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1200
    scene.render.filepath = str(PREVIEW)
    return style_root


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    DEPTH.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = setup_scene()
    root = bpy.data.objects.new("FrozenAbyss_Autotile_ROOT", None)
    root.rotation_euler.z = math.radians(ROOT_ROTATION_Z)
    scene.collection.objects.link(root)
    mats = {
        "board": material("ApprovalBoard", "#24292d", 0.98),
        "void": material("FrozenAbyssVoid", "#061019", 0.80),
        "cliff": material("StratifiedBlueIce", "#496b78", 0.64),
        "snow": material("CompactedSnowLip", "#cbd3d5", 0.90),
        "frost": material("FracturedFrost", "#879fab", 0.72),
        "label": material("MaskLabel", "#b8a981", 0.84),
    }

    board_collection = bpy.data.collections.new("ApprovalBoard")
    scene.collection.children.link(board_collection)
    board = cube("ApprovalBoard", (0, 0, -0.78), (16.0, 16.0, 0.08),
                 mats["board"], board_collection, bevel=0.10, parent=root)
    board["approval_only"] = True

    for mask in range(16):
        col = mask % 4
        row = mask // 4
        center = ((col - 1.5) * TILE_SPACING, (1.5 - row) * TILE_SPACING)
        build_mask(mask, center, mats, root)

    bpy.context.view_layer.update()
    scene.render.filepath = str(PREVIEW)
    bpy.ops.render.render(write_still=True)
    render_depth(scene, DEPTH)
    render_seam_proof(scene, mats, root)
    render_style_reference(scene, mats, root)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

    manifest = {
        "asset": "frozen_abyss_autotile",
        "stage": "blockout_approval",
        "scope": ["frozenBeginner", "frozenMid", "frozen"],
        "logicalCell": {"width": GRID_CELL[0], "depth": GRID_CELL[1]},
        "maskBits": [{"bit": bit, "direction": direction}
                     for bit, direction in enumerate(MASK_DIRECTIONS)],
        "frameCount": 16,
        "assetClass": "terrain_autotile_natural_structure",
        "styleVersion": "world122-building-v5",
        "styleTemplate": str(PUBLIC_STYLE.relative_to(ROOT)).replace("\\", "/"),
        "assetPrompt": str(STYLE_PROMPT.relative_to(ROOT)).replace("\\", "/"),
        "foundationStyle": "none_terrain_cutout",
        "camera": {
            "type": "orthographic",
            "elevationDegrees": 30.0,
            "azimuthDegrees": 0.0,
            "rootRotationDegrees": ROOT_ROTATION_Z,
        },
        "lighting": "World-122 soft neutral upper-left top-side key plus broad fill",
        "materialDirection": {
            "target": "clean semi-realistic strategy-game PBR",
            "largeForms": ["compacted snow overhang", "stratified blue-ice break", "deep low-detail void"],
            "detailDensity": "sparse medium-scale fractures; no micro-grain or regular teeth",
            "color": "low-saturation neutral blue-gray with restrained value separation",
        },
        "outputs": {
            "blend": str(BLEND.relative_to(ROOT)).replace("\\", "/"),
            "approvalPreview": str(PREVIEW.relative_to(ROOT)).replace("\\", "/"),
            "depth": str(DEPTH.relative_to(ROOT)).replace("\\", "/"),
            "seamProof": str(SEAM_PROOF.relative_to(ROOT)).replace("\\", "/"),
            "seamDepth": str(SEAM_DEPTH.relative_to(ROOT)).replace("\\", "/"),
            "isolatedStylePreview": str(STYLE_PREVIEW.relative_to(ROOT)).replace("\\", "/"),
            "isolatedStyleDepth": str(STYLE_DEPTH.relative_to(ROOT)).replace("\\", "/"),
            "stylePreview": str(STYLE_FLOOR_PREVIEW.relative_to(ROOT)).replace("\\", "/"),
            "styleDepth": str(STYLE_FLOOR_DEPTH.relative_to(ROOT)).replace("\\", "/"),
        },
        "runtimeComposition": {
            "masters": ["void", "+u edge", "+v edge", "-u edge", "-v edge"],
            "atlasFrames": "deterministically compose the five masters into the 16 neighbor masks",
            "reason": "one authored edge per direction prevents mask-to-mask material and lighting drift",
        },
        "runtimeStatus": "not_integrated_pending_user_approval",
        "notes": [
            "The preview uses diagnostic blockout materials, not final PBR art.",
            "The blockout inherits World-122 building-v5 camera, lighting, value hierarchy and material density.",
            "The frozen dungeon contributes only snow/ice identity; legacy cartoon-like wall rendering is not the style authority.",
            "Runtime must select frames by neighborMask; no frame may be rotated or stretched.",
            "Void cells use non-beveled slight overdraw; rim endpoints keep a fixed seam profile.",
            "Final abyss interior remains a baked terrain layer; only rim/cliff topology comes from the atlas.",
        ],
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved blend: {BLEND}")
    print(f"saved approval preview: {PREVIEW}")
    print(f"saved depth: {DEPTH}")
    print(f"saved seam proof: {SEAM_PROOF}")
    print(f"saved seam depth: {SEAM_DEPTH}")
    print(f"saved style preview: {STYLE_FLOOR_PREVIEW}")
    print(f"saved style depth: {STYLE_FLOOR_DEPTH}")
    print(f"saved manifest: {MANIFEST}")


if __name__ == "__main__":
    main()
