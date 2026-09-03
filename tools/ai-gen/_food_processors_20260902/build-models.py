"""Build the two bakery-tier food processor model candidates.

Only editable Blender source, approval preview, Depth and shadow metadata are
produced here. Runtime art remains untouched until the user approves the model.
"""
import importlib.util
import json
import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[3]
PACK_PATH = ROOT / "tools" / "ai-gen" / "settlement-building-pack-blender.py"
PACK_SPEC = importlib.util.spec_from_file_location("world122_settlement_pack", PACK_PATH)
pack = importlib.util.module_from_spec(PACK_SPEC)
PACK_SPEC.loader.exec_module(pack)
kit = pack.kit


def _mat(name, rgba, *, roughness=0.8, metallic=0.0, emission=None):
    return kit.material(name, kit.rgba(rgba), roughness=roughness,
                        metallic=metallic, emission=emission)


def _uv_ellipsoid(collection, root, name, location, scale, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.parent = root
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    kit.move_to_collection(obj, collection)
    return obj


def _pipe_between(collection, root, name, start, end, radius, material):
    a, b = pack.mathutils.Vector(start), pack.mathutils.Vector(end)
    obj = kit.cylinder(collection, root, name, radius, (b - a).length,
                       (a + b) / 2, material, vertices=20, bevel_width=0.5)
    obj.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return obj


def build_desert_cookhouse(spec):
    collection, root, mats = pack.common_context("desert_cookhouse", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["mainBody"]
    rw, rd, rh = dims["roofDeck"]
    front_y = -bd / 2
    left_x = -bw / 2
    top = fh + bh
    clay = _mat("MAT_DesertCookhouse_FiredClay", (0.49, 0.245, 0.085, 1), roughness=0.94)
    dark = _mat("MAT_DesertCookhouse_OvenMouth", (0.025, 0.018, 0.012, 1), roughness=0.98)
    cloth = _mat("MAT_DesertCookhouse_ShadeCloth", (0.36, 0.17, 0.055, 1), roughness=0.95)
    spice = _mat("MAT_DesertCookhouse_DriedSpice", (0.42, 0.075, 0.025, 1), roughness=0.9)

    kit.box(collection, root, "DesertCookhouse_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    kit.box(collection, root, "DesertCookhouse_MainHall_AdobeBody", (bw, bd, bh),
            (18, 10, fh + bh / 2), mats["plaster"], bevel_width=5)
    kit.box(collection, root, "DesertCookhouse_MainHall_StoneSkirt", (bw + 8, bd + 8, 44),
            (18, 10, fh + 22), mats["stone"], bevel_width=4)
    kit.box(collection, root, "DesertCookhouse_FlatRoofDeck", (rw, rd, rh),
            (18, 10, top + rh / 2), mats["roof"], bevel_width=5)
    for side, x in (("L", 18 - rw / 2 + 9), ("R", 18 + rw / 2 - 9)):
        kit.box(collection, root, f"DesertCookhouse_Parapet_{side}", (18, rd, 35),
                (x, 10, top + 25), mats["plaster"], bevel_width=3)
    for side, y in (("Front", 10 - rd / 2 + 9), ("Back", 10 + rd / 2 - 9)):
        kit.box(collection, root, f"DesertCookhouse_Parapet_{side}", (rw, 18, 35),
                (18, y, top + 25), mats["plaster"], bevel_width=3)

    kit.double_doors(collection, root, "DesertCookhouse_MainDoor",
                     (43, front_y + 6, fh), 64, 98, mats["timber"], mats["iron"],
                     open_angle=34)
    kit.box(collection, root, "DesertCookhouse_MainDoor_Lintel", (86, 18, 14),
            (43, front_y + 5, fh + 104), mats["stone"], bevel_width=2)
    kit.shutter_window(collection, root, "DesertCookhouse_ServiceWindow",
                       (108, front_y + 4, fh + 82), mats["glass"], mats["timber"],
                       mats["iron"], scale=0.85)

    # Three clay domes share and visibly overlap the main side wall.
    for index, (x, y) in enumerate(dims["ovenCenters"]):
        center_z = fh + 40
        _uv_ellipsoid(collection, root, f"DesertCookhouse_AttachedOven{index}_Dome",
                      (x, y, center_z), (1.0, 0.92, 0.82), clay).dimensions = (82, 76, 68)
        kit.box(collection, root, f"DesertCookhouse_AttachedOven{index}_WallNeck",
                (34, 50, 58), (left_x + 4, y, fh + 32), clay, bevel_width=8)
        kit.cylinder(collection, root, f"DesertCookhouse_AttachedOven{index}_DarkMouth",
                     18, 7, (x - 39, y, fh + 28), dark,
                     rotation=(0, 90, 0), vertices=32, bevel_width=1)
        kit.box(collection, root, f"DesertCookhouse_AttachedOven{index}_Hearth",
                (31, 54, 9), (x - 42, y, fh + 5), mats["stone"], bevel_width=2)

    # Broad heat chimney is attached to the hall and fed by all three ovens.
    kit.box(collection, root, "DesertCookhouse_HeatFlue_Attached", (44, 118, 54),
            (-118, 13, fh + 67), clay, bevel_width=8)
    kit.chimney(collection, root, "DesertCookhouse_BroadHeatChimney",
                (-105, 54, top + 41), mats["stone"], mats["iron"], height=126)

    cw, cd, ch = dims["canopy"]
    canopy_x = 55
    canopy_y = front_y - 34
    canopy_z = fh + 139
    kit.box(collection, root, "DesertCookhouse_ShadeCanopy", (cw, cd, ch),
            (canopy_x, canopy_y, canopy_z), cloth, rotation=(7, 0, 0), bevel_width=3)
    kit.box(collection, root, "DesertCookhouse_ShadeCanopy_WallBeam", (cw + 5, 14, 15),
            (canopy_x, front_y + 4, canopy_z + 6), mats["timber"], bevel_width=2)
    for index, x in enumerate((canopy_x - cw / 2 + 12, canopy_x + cw / 2 - 12)):
        kit.box(collection, root, f"DesertCookhouse_ShadeCanopy_Post{index}", (11, 11, 124),
                (x, canopy_y - 29, fh + 62), mats["timber"], bevel_width=2)

    # All production props are fixed under the canopy or against the wall.
    for index, x in enumerate((7, 42, 77, 112)):
        kit.cylinder(collection, root, f"DesertCookhouse_ClayJar{index}_Body", 14, 35,
                     (x, canopy_y - 6, fh + 18), clay, vertices=24, bevel_width=3)
        kit.torus_ring(collection, root, f"DesertCookhouse_ClayJar{index}_Rim", 10, 2,
                       (x, canopy_y - 6, fh + 36), mats["brass"], major_segments=24)
    rack_z = fh + 87
    kit.box(collection, root, "DesertCookhouse_DryingRack_Top", (118, 9, 9),
            (56, front_y - 18, rack_z + 34), mats["timber"], bevel_width=1)
    for side in (-1, 1):
        kit.box(collection, root, f"DesertCookhouse_DryingRack_Post{side}", (8, 8, 72),
                (56 + side * 52, front_y - 18, rack_z), mats["timber"], bevel_width=1)
    for index, x in enumerate((20, 44, 68, 92)):
        _pipe_between(collection, root, f"DesertCookhouse_DryingCord{index}",
                      (x, front_y - 20, rack_z + 31), (x, front_y - 20, rack_z + 5),
                      1.5, mats["iron"])
        _uv_ellipsoid(collection, root, f"DesertCookhouse_DriedSpiceBundle{index}",
                      (x, front_y - 21, rack_z - 1), (9, 5, 16), spice)

    # Text-free bowl and flame emblem fixed to the parapet.
    kit.box(collection, root, "DesertCookhouse_Badge_Back", (82, 12, 58),
            (70, front_y - 2, top - 11), mats["timber"], bevel_width=7)
    kit.torus_ring(collection, root, "DesertCookhouse_Badge_Bowl", 22, 4,
                   (70, front_y - 10, top - 18), mats["brass"], rotation=(90, 0, 0),
                   major_segments=32)
    _uv_ellipsoid(collection, root, "DesertCookhouse_Badge_Flame",
                  (70, front_y - 13, top + 7), (8, 4, 19), mats["glow"])
    kit.lantern(collection, root, "DesertCookhouse_EntranceLantern",
                (4, front_y - 13, fh + 87), mats["iron"], mats["glow"])
    return root


def build_frost_smokehouse(spec):
    collection, root, mats = pack.common_context("frost_smokehouse", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    front_y = -bd / 2
    left_x = -bw / 2
    roof_base = fh + bh - 4
    interior = _mat("MAT_FrostSmokehouse_DarkInterior", (0.018, 0.022, 0.023, 1), roughness=0.98)
    cured = _mat("MAT_FrostSmokehouse_CuredFood", (0.34, 0.11, 0.055, 1), roughness=0.9)
    cold_glass = _mat("MAT_FrostSmokehouse_ColdGlass", (0.08, 0.24, 0.28, 1),
                      roughness=0.28, emission=(kit.rgba((0.08, 0.24, 0.28, 1)), 0.28))

    kit.box(collection, root, "FrostSmokehouse_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    kit.box(collection, root, "FrostSmokehouse_MainHall_StoneBody", (bw, bd, bh),
            (0, 8, fh + bh / 2), mats["stone"], bevel_width=5)
    kit.box(collection, root, "FrostSmokehouse_MainHall_TimberUpper", (bw - 10, bd - 10, 92),
            (0, 8, fh + bh - 46), mats["plaster"], bevel_width=3)
    kit.half_timber_facade(collection, root, "FrostSmokehouse_FrontTimber", bw - 4,
                           92, front_y + 4, fh + bh - 92, mats["timber"], bays=4)
    kit.half_timber_side(collection, root, "FrostSmokehouse_SideTimber", bd - 4,
                         92, left_x + 4, fh + bh - 92, mats["timber"], bays=3)

    kit.double_doors(collection, root, "FrostSmokehouse_MainDoor",
                     (-62, front_y - 2, fh), 72, 106, mats["timber"], mats["iron"],
                     open_angle=22)
    kit.box(collection, root, "FrostSmokehouse_MainDoor_DarkOpening", (58, 8, 91),
            (-62, front_y + 5, fh + 48), interior, bevel_width=10)
    kit.shutter_window(collection, root, "FrostSmokehouse_FrontWindow",
                       (55, front_y - 3, fh + 91), cold_glass, mats["timber"],
                       mats["iron"], scale=0.86)
    kit.shutter_window(collection, root, "FrostSmokehouse_SideWindow",
                       (left_x - 3, 38, fh + 92), cold_glass, mats["timber"],
                       mats["iron"], orientation="side", scale=0.82)

    kit.gabled_prism(collection, root, "FrostSmokehouse_ContinuousSteepRoof",
                     rw, rd, rh, (0, 8, roof_base), mats["timber"], mats["roof"])
    # The snow is a single continuous roof shell.  The earlier narrow courses read
    # like a rectangular white panel from the approval camera instead of settled snow.
    # Keeping the shell slightly inset preserves a dark timber eave on every side.
    kit.gabled_prism(collection, root, "FrostSmokehouse_RestrainedSnowCap",
                     rw - 10, rd - 12, rh + 12, (0, 9, roof_base + 7),
                     mats["snow"], mats["snow"])
    kit.box(collection, root, "FrostSmokehouse_RoofRidge", (rw + 8, 11, 12),
            (0, 8, roof_base + rh + 3), mats["timber"], bevel_width=2)

    # One wide attached chimney; the dark cap opening remains visible against snow.
    kit.chimney(collection, root, "FrostSmokehouse_BroadSmokeChimney",
                (-104, 42, roof_base + 64), mats["stone"], mats["iron"], height=154)
    kit.cylinder(collection, root, "FrostSmokehouse_Chimney_DarkMouth", 23, 5,
                 (-104, 42, roof_base + 64 + 154), interior, vertices=32, bevel_width=1)
    for y in (-15, 16, 47):
        _pipe_between(collection, root, f"FrostSmokehouse_InteriorSmokeDuct_{y}",
                      (-104, y, fh + 117), (-104, 42, roof_base + 46), 5,
                      mats["iron"])

    # Curing porch is attached to the front wall and enclosed by slats.
    pw, pd, ph = dims["curingPorch"]
    porch_x = 71
    porch_y = front_y - 35
    porch_z = fh + 126
    kit.box(collection, root, "FrostSmokehouse_CuringPorch_Roof", (pw, pd, ph),
            (porch_x, porch_y, porch_z), mats["roof"], rotation=(9, 0, 0), bevel_width=3)
    kit.box(collection, root, "FrostSmokehouse_CuringPorch_WallBeam", (pw + 5, 14, 15),
            (porch_x, front_y + 3, porch_z + 7), mats["timber"], bevel_width=2)
    for index, x in enumerate((porch_x - pw / 2 + 10, porch_x + pw / 2 - 10)):
        kit.box(collection, root, f"FrostSmokehouse_CuringPorch_Post{index}", (12, 12, 119),
                (x, porch_y - 30, fh + 59), mats["timber"], bevel_width=2)
    for index, x in enumerate(range(7, 140, 22)):
        kit.box(collection, root, f"FrostSmokehouse_CuringPorch_Slat{index}", (8, 8, 88),
                (porch_x - 66 + index, porch_y - 34, fh + 49), mats["timber"], bevel_width=1)
    rack_z = fh + 91
    kit.box(collection, root, "FrostSmokehouse_CuringRack_Top", (126, 9, 9),
            (porch_x, porch_y - 12, rack_z + 26), mats["iron"], bevel_width=1)
    for index, x in enumerate((porch_x - 45, porch_x - 15, porch_x + 15, porch_x + 45)):
        _pipe_between(collection, root, f"FrostSmokehouse_CuringHook{index}",
                      (x, porch_y - 13, rack_z + 22), (x, porch_y - 13, rack_z + 2),
                      1.7, mats["iron"])
        _uv_ellipsoid(collection, root, f"FrostSmokehouse_CuredFood{index}",
                      (x, porch_y - 13, rack_z - 8), (11, 7, 17), cured)

    # Attached, text-free smoke ring badge.
    kit.box(collection, root, "FrostSmokehouse_Badge_Back", (80, 11, 64),
            (60, front_y - 10, fh + bh - 24), mats["timber"], bevel_width=8)
    for index, (radius, z) in enumerate(((21, fh + bh - 31), (13, fh + bh - 9))):
        kit.torus_ring(collection, root, f"FrostSmokehouse_Badge_SmokeRing{index}", radius, 3,
                       (60, front_y - 18, z), mats["brass"], rotation=(90, 0, 0),
                       major_segments=32)
    kit.lantern(collection, root, "FrostSmokehouse_EntranceLantern",
                (-17, front_y - 15, fh + 91), mats["iron"], mats["glow"])
    return root


if __name__ == "__main__":
    manifest_path, asset_id, blend_path, preview_path, depth_path, body_depth_path, _ = pack.parse_args()
    pack.BUILDERS.update(
        desert_cookhouse=build_desert_cookhouse,
        frost_smokehouse=build_frost_smokehouse,
    )
    def render_body_depth_in_process(source_manifest, building_id, _blend_path,
                                     _preview_path, _depth_path, output_path):
        source = json.loads(Path(source_manifest).read_text(encoding="utf-8-sig"))
        spec = source["buildings"][building_id]
        hidden = []
        for object_name in spec.get("bodyDepthExclude", []):
            obj = bpy.data.objects.get(object_name)
            if obj is None:
                raise SystemExit(f"body-depth object missing for {building_id}: {object_name}")
            hidden.append((obj, obj.hide_render))
            obj.hide_render = True
        try:
            root = bpy.data.objects[building_id.upper() + "_ROOT_ROT_Z_44_8"]
            kit.render_depth(bpy.context.scene, root, bpy.context.scene.camera,
                             output_path, building_id + "_Body")
        finally:
            for obj, previous in hidden:
                obj.hide_render = previous

    # The central pack launches itself for Body Depth. New task-local IDs are not
    # registered there, so keep the same camera/model alive and render locally.
    pack.spawn_saved_body_depth = render_body_depth_in_process
    bpy.context.preferences.filepaths.save_version = 0
    pack.main()
    source = json.loads(Path(manifest_path).read_text(encoding="utf-8-sig"))
    metadata = {
        "assetId": asset_id,
        "name": source["buildings"][asset_id]["name"],
        "revision": source["revision"],
        "status": "model_candidate_awaiting_user_review",
        "model": Path(blend_path).name,
        "preview": Path(preview_path).name.replace("_model_preview", "_model_approval_preview"),
        "depth": Path(depth_path).name,
        "bodyDepth": Path(body_depth_path).name if body_depth_path else None,
        "footprintCells": 2,
        "cameraElevation": 30,
        "rootRotationZ": 44.8,
        "runtimeInstalled": False,
        "aiGenerationStarted": False,
        "userApproved": False,
        "builder": source["builder"],
        "componentSource": source["componentSource"]
    }
    (Path(blend_path).parent / "model-metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
