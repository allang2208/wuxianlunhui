#!/usr/bin/env python3
"""Build the editable World-122 Tier-5 interplane research hub model.

The task-local builder reuses the canonical component kit, 30-degree camera,
44.8-degree building rotation, approval preview, and Depth render pipeline.
It only creates model-stage artifacts and never installs runtime art.
"""

import importlib.util
import math
from pathlib import Path
import subprocess


PACK_PATH = Path(__file__).resolve().parents[1] / "settlement-building-pack-blender.py"
MODULE = importlib.util.spec_from_file_location("interplane_hub_settlement_pack", PACK_PATH)
pack = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(pack)
kit = pack.kit
bpy = pack.bpy


def build_interplane_research_hub(spec):
    building_id = spec["assetId"]
    collection, root, mats = pack.common_context(building_id, spec)
    prefix = "InterplaneResearchHub"
    palette = dict(spec["palette"])
    palette.update(spec.get("paletteOverrides", {}))

    def rgba(key):
        return kit.rgba(palette[key])

    mats.update({
        "precast": kit.material(
            prefix + "_MAT_PrecisePrecastConcrete", rgba("concrete"),
            roughness=0.84,
            noise={"scale": 5.0, "detail": 1.5, "bump": 0.045,
                   "dark": tuple(c * 0.93 for c in rgba("concrete")[:3]) + (1.0,),
                   "light": tuple(min(1.0, c * 1.04) for c in rgba("concrete")[:3]) + (1.0,)},
        ),
        "panel": kit.material(
            prefix + "_MAT_WarmMineralPanel", rgba("ceramic"),
            roughness=0.80,
            noise={"scale": 6.0, "detail": 1.0, "bump": 0.03,
                   "dark": tuple(c * 0.95 for c in rgba("ceramic")[:3]) + (1.0,),
                   "light": tuple(min(1.0, c * 1.03) for c in rgba("ceramic")[:3]) + (1.0,)},
        ),
        "steel": kit.material(prefix + "_MAT_CharcoalStructuralSteel", rgba("machine"),
                               roughness=0.48, metallic=0.58),
        "bronze": kit.material(prefix + "_MAT_AgedCoordinationBronze", rgba("brass"),
                                roughness=0.42, metallic=0.66),
        "hub_glass": kit.material(prefix + "_MAT_DeepTealResearchGlass", rgba("glass"),
                                   roughness=0.23, metallic=0.03,
                                   emission=(rgba("glass"), 0.18)),
        "phase_glass": kit.material(prefix + "_MAT_RestrainedPhaseGlass", rgba("glow"),
                                     roughness=0.18, metallic=0.02,
                                     emission=(rgba("glow"), 0.9)),
        "interior": kit.material(prefix + "_MAT_DeepInterior", rgba("interior"),
                                  roughness=0.95),
    })

    def box(name, size, location, material, rotation=(0, 0, 0), bevel=1.5):
        return kit.box(collection, root, prefix + "_" + name, size, location,
                       mats[material], rotation=rotation, bevel_width=bevel)

    def cylinder(name, radius, depth, location, material, rotation=(0, 0, 0),
                 vertices=48, bevel=1.0):
        obj = kit.cylinder(collection, root, prefix + "_" + name, radius, depth,
                           location, mats[material], rotation=rotation,
                           vertices=vertices, bevel_width=bevel)
        for polygon in obj.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4
        return obj

    def sphere(name, radius, location, material, scale=(1.0, 1.0, 1.0)):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=40, ring_count=20, radius=radius, location=location)
        obj = bpy.context.object
        obj.name = prefix + "_" + name
        obj.parent = root
        obj.scale = scale
        obj.data.materials.append(mats[material])
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        kit.move_to_collection(obj, collection)
        return obj

    def window(name, location, width, height, orientation="front", vdiv=3, hdiv=1):
        return kit.framed_glass_panel(
            collection, root, prefix + "_" + name, location, width, height,
            mats["hub_glass"], mats["steel"], mats["bronze"],
            orientation=orientation, vertical_divisions=vdiv,
            horizontal_divisions=hdiv, ornaments=False, depth=8.0)

    def ring(name, radius, thickness, location, rotation=(0, 0, 0), material="bronze"):
        return kit.torus_ring(
            collection, root, prefix + "_" + name, radius, thickness,
            location, mats[material], rotation=rotation,
            major_segments=72, minor_segments=12)

    dims = spec["dimensions"]
    foundation_w, foundation_d, foundation_h = dims["foundation"]
    pad_h = dims["foundationPadHeight"]
    floor_z = foundation_h + pad_h

    # Full 4x4 near-future precast foundation.  It is a visual structure only
    # and does not alter the established 4x4 runtime footprint.
    box("Foundation_Base", (foundation_w, foundation_d, foundation_h),
        (0, 0, foundation_h / 2), "precast", bevel=5.0)
    inset = dims["foundationInset"]
    box("Foundation_InsetPad",
        (foundation_w - inset * 2, foundation_d - inset * 2, pad_h),
        (0, 0, foundation_h + pad_h / 2), "panel", bevel=2.5)
    curb_h = 11
    for side in (-1, 1):
        box(f"Foundation_CurbFrontBack_{side}", (foundation_w - 28, 15, curb_h),
            (0, side * (foundation_d / 2 - 10), foundation_h + curb_h / 2),
            "precast", bevel=2.0)
        box(f"Foundation_CurbLeftRight_{side}", (15, foundation_d - 28, curb_h),
            (side * (foundation_w / 2 - 10), 0, foundation_h + curb_h / 2),
            "precast", bevel=2.0)

    # Six independently named, centered bearing shells make the terminal hub
    # genuinely monumental.  Broad mineral-panel walls and structural piers keep
    # it distinct from the old six-storey glass office placeholder.
    core_w, core_d, core_h = dims["centralCore"]
    core_y = dims["centralCenterY"]
    core_front = core_y - core_d / 2
    central_levels = dims.get("centralLevels", 6)
    floor_h = core_h / central_levels
    core_sizes = (
        (core_w, core_d),
        (core_w, core_d),
        (core_w - 8, core_d - 8),
        (core_w - 16, core_d - 16),
        (core_w - 28, core_d - 26),
        (core_w - 42, core_d - 36),
    )
    if central_levels != len(core_sizes):
        raise ValueError("interplane hub centralLevels must remain six")
    for level, (level_w, level_d) in enumerate(core_sizes, start=1):
        z0 = floor_z + (level - 1) * floor_h
        box(f"CentralCore_Level{level}_BearingShell", (level_w, level_d, floor_h),
            (0, core_y, z0 + floor_h / 2),
            "panel" if level > 1 else "precast", bevel=5.0)
        if level > 1:
            box(f"CentralCore_Level{level}_SlabBand",
                 (level_w + 18, level_d + 18, 10),
                 (0, core_y, z0), "steel", bevel=2.0)
        for side in (-1, 1):
            box(f"CentralCore_Level{level}_FrontPier_{side}",
                (14, 18, floor_h - 14),
                (side * (level_w / 2 - 16), core_y - level_d / 2 - 5,
                 z0 + floor_h / 2),
                "bronze" if level >= 5 else "steel", bevel=1.2)
    core_top = floor_z + core_h
    box("CentralCore_RoofPlate", (core_sizes[-1][0] + 34, core_sizes[-1][1] + 34, 18),
        (0, core_y, core_top + 9), "precast", bevel=3.0)

    # Two attached five-storey data/archive wings rise with the six-storey core.
    # Their inner walls overlap it so the composition remains one grand campus.
    wing_w, wing_d, wing_h = dims["wing"]
    wing_x = dims["wingCenterX"]
    wing_y = dims["wingCenterY"]
    wing_levels = dims.get("wingLevels", 5)
    wing_floor_h = wing_h / wing_levels
    for side in (-1, 1):
        label = "Left" if side < 0 else "Right"
        x = side * wing_x
        for level in range(1, wing_levels + 1):
            z0 = floor_z + (level - 1) * wing_floor_h
            box(f"{label}Wing_Level{level}_BearingShell",
                (wing_w, wing_d, wing_floor_h),
                (x, wing_y, z0 + wing_floor_h / 2),
                "panel" if level > 1 else "precast", bevel=5.0)
            if level > 1:
                box(f"{label}Wing_Level{level}_SlabBand",
                    (wing_w + 16, wing_d + 16, 9),
                    (x, wing_y, z0), "steel", bevel=1.8)
        wing_top = floor_z + wing_h
        box(f"{label}Wing_RoofPlate", (wing_w + 28, wing_d + 28, 16),
            (x, wing_y, wing_top + 8), "precast", bevel=3.0)
        for edge in (-1, 1):
            box(f"{label}Wing_ParapetX_{edge}", (10, wing_d + 18, 27),
                (x + edge * (wing_w / 2 + 7), wing_y, wing_top + 25),
                "precast", bevel=1.5)
        box(f"{label}Wing_RearParapet", (wing_w + 18, 10, 27),
            (x, wing_y + wing_d / 2 + 7, wing_top + 25),
            "precast", bevel=1.5)
        # A roof-attached archive node is a low instrument, not another tower.
        node_z = wing_top + 36
        cylinder(f"{label}Wing_ArchiveNode_Base", 48, 18,
                 (x, wing_y + 52, node_z), "steel", vertices=10, bevel=1.2)
        cylinder(f"{label}Wing_ArchiveNode_Glass", 36, 48,
                 (x, wing_y + 52, node_z + 30), "hub_glass", vertices=10, bevel=1.0)
        ring(f"{label}Wing_ArchiveNode_LowerBand", 38, 3.2,
             (x, wing_y + 52, node_z + 18), material="steel")
        ring(f"{label}Wing_ArchiveNode_UpperBand", 38, 3.2,
             (x, wing_y + 52, node_z + 44), material="bronze")
        cylinder(f"{label}Wing_ArchiveNode_Cap", 45, 12,
                 (x, wing_y + 52, node_z + 58), "bronze", vertices=10, bevel=1.0)
        sphere(f"{label}Wing_ArchiveNode_PhaseLens", 11,
               (x, wing_y + 52, node_z + 70), "phase_glass",
               scale=(0.85, 0.85, 1.12))

    # Centered entrance with a true dark recess, separate glass leaves, broad
    # backed stairs, and a solid canopy.  No text or runtime road is modeled.
    entrance_w, entrance_d, entrance_h = dims["entranceAtrium"]
    entrance_y = dims["entranceCenterY"]
    entrance_front = entrance_y - entrance_d / 2
    box("EntranceAtrium_BearingShell", (entrance_w, entrance_d, entrance_h),
        (0, entrance_y, floor_z + entrance_h / 2), "steel", bevel=4.0)
    box("EntranceAtrium_GlassFront", (entrance_w - 30, 8, entrance_h - 28),
        (0, entrance_front - 4, floor_z + entrance_h / 2), "hub_glass", bevel=2.0)
    door_w, door_h = dims["entranceDoor"]
    box("Entrance_DarkRecess", (door_w + 24, 6, door_h + 12),
        (0, entrance_front - 11, floor_z + door_h / 2), "interior", bevel=1.0)
    for side in (-1, 1):
        box(f"Entrance_GlassDoor_{side}", (door_w / 2 - 7, 5, door_h),
            (side * (door_w / 4 + 2), entrance_front - 15,
             floor_z + door_h / 2), "hub_glass", bevel=1.0)
        box(f"Entrance_DoorFrame_{side}", (6, 9, door_h + 10),
            (side * (door_w / 2 + 6), entrance_front - 17,
             floor_z + door_h / 2), "bronze", bevel=0.8)
    box("Entrance_Canopy", (entrance_w + 38, 88, 16),
        (0, entrance_front - 37, floor_z + entrance_h - 21),
        "precast", bevel=3.0)
    for side in (-1, 1):
        box(f"Entrance_CanopyColumn_{side}", (14, 14, entrance_h - 28),
            (side * (entrance_w / 2 + 5), entrance_front - 40,
             floor_z + (entrance_h - 28) / 2), "bronze", bevel=1.2)
    for index, (width, depth, yoff, height) in enumerate((
            (204, 56, -32, 8), (176, 49, -14, 13), (148, 43, 5, 18)), start=1):
        box(f"Entrance_Step_{index}", (width, depth, height),
            (0, entrance_front + yoff, foundation_h + height / 2),
            "precast", bevel=1.5)

    # Large, low-frequency window groupings preserve research readability at
    # runtime scale and avoid recreating the placeholder office curtain wall.
    for story in range(central_levels):
        z = floor_z + floor_h * (story + 0.5)
        for side in (-1, 1):
            window(f"CentralCore_FrontWindow_L{story+1}_{side}",
                   (side * 92, core_front - 7, z), 78, 48, vdiv=2, hdiv=1)
    for side in (-1, 1):
        label = "Left" if side < 0 else "Right"
        x = side * wing_x
        wing_front = wing_y - wing_d / 2
        for story in range(wing_levels):
            z = floor_z + wing_floor_h * (story + 0.5)
            window(f"{label}Wing_FrontWindow_L{story+1}",
                   (x, wing_front - 7, z), wing_w - 70, 48, vdiv=3, hdiv=1)
        outer_x = x - side * (wing_w / 2 + 6)
        for index, y in enumerate((wing_y - 82, wing_y + 15, wing_y + 112), start=1):
            window(f"{label}Wing_SideWindow_{index}",
                   (outer_x, y, floor_z + wing_h * 0.52), 68, 108,
                   orientation="side", vdiv=2, hdiv=2)

    # Roof-integrated decagonal coordination chamber.  Five node pylons and
    # their radial braces sit on real supports; no part is a floating portal.
    drum_radius = dims["coordinationDrumRadius"]
    drum_h = dims["coordinationDrumHeight"]
    drum_base_z = core_top + 28
    cylinder("CoordinationDrum_Base", drum_radius + 20, 26,
             (0, core_y, drum_base_z), "precast", vertices=10, bevel=2.2)
    cylinder("CoordinationDrum_Glass", drum_radius, drum_h,
             (0, core_y, drum_base_z + 13 + drum_h / 2),
             "hub_glass", vertices=10, bevel=1.5)
    drum_mid_z = drum_base_z + 13 + drum_h / 2
    for index in range(10):
        angle = math.tau * index / 10
        x = math.cos(angle) * (drum_radius + 3)
        y = core_y + math.sin(angle) * (drum_radius + 3)
        box(f"CoordinationDrum_Frame_{index+1:02d}", (8, 8, drum_h + 18),
            (x, y, drum_mid_z), "steel", rotation=(0, 0, math.degrees(angle)),
            bevel=0.8)
    crown_base_z = drum_base_z + drum_h + 33
    cylinder("CoordinationDrum_CrownDeck", drum_radius + 24, 18,
             (0, core_y, crown_base_z), "bronze", vertices=10, bevel=2.0)

    # Five fixed phase regulators and their sockets turn the roof into a real
    # coordination machine room instead of a bare pair of rings.
    for index in range(5):
        angle = math.tau * index / 5 - math.pi / 2
        rx = math.cos(angle) * 72
        ry = core_y + math.sin(angle) * 72
        cylinder(f"CoordinationDeck_Regulator_{index+1}_Socket", 24, 12,
                 (rx, ry, crown_base_z + 13), "steel", vertices=10, bevel=1.0)
        box(f"CoordinationDeck_Regulator_{index+1}_Cabinet", (30, 24, 38),
            (rx, ry, crown_base_z + 33), "bronze",
            rotation=(0, 0, math.degrees(angle)), bevel=2.0)
        sphere(f"CoordinationDeck_Regulator_{index+1}_Indicator", 6,
               (rx, ry, crown_base_z + 54), "phase_glass",
               scale=(0.9, 0.9, 1.05))

    ring_radius = dims["coordinationRingRadius"]
    ring_z = crown_base_z + 58
    ring("CoordinationCrown_LowerRing", ring_radius, 8,
         (0, core_y, ring_z), material="bronze")
    ring("CoordinationCrown_UpperRing", ring_radius - 14, 6,
         (0, core_y, ring_z + 46), material="steel")
    cylinder("CoordinationCrown_CentralPylon", 28, 118,
             (0, core_y, crown_base_z + 59), "steel", vertices=10, bevel=1.5)
    cylinder("CoordinationCrown_CentralPhaseColumn", 17, 88,
             (0, core_y, crown_base_z + 69), "phase_glass", vertices=10, bevel=1.0)
    sphere("CoordinationCrown_CentralLens", 28,
           (0, core_y, ring_z + 47), "phase_glass", scale=(0.82, 0.82, 1.18))

    for index in range(5):
        angle = math.tau * index / 5 - math.pi / 2
        x = math.cos(angle) * ring_radius
        y = core_y + math.sin(angle) * ring_radius
        label = index + 1
        cylinder(f"PlaneNode_{label}_DeckSocket", 30, 16,
                 (x, y, crown_base_z + 15), "precast", vertices=10, bevel=1.2)
        cylinder(f"PlaneNode_{label}_ArmoredPlinth", 22, 22,
                 (x, y, crown_base_z + 31), "bronze", vertices=10, bevel=1.0)
        cylinder(f"PlaneNode_{label}_SupportPylon", 12, 60,
                 (x, y, crown_base_z + 45), "steel", vertices=10, bevel=1.0)
        tangent_x = -math.sin(angle)
        tangent_y = math.cos(angle)
        for side in (-1, 1):
            box(f"PlaneNode_{label}_Yoke_{side}", (8, 8, 52),
                (x + tangent_x * side * 18, y + tangent_y * side * 18,
                 ring_z - 12), "steel", bevel=1.0)
        sphere(f"PlaneNode_{label}_Lens", 18, (x, y, ring_z),
               "phase_glass", scale=(0.86, 0.86, 1.08))
        ring(f"PlaneNode_{label}_LensCollar", 24, 3.5,
             (x, y, ring_z), material="bronze")
        cylinder(f"PlaneNode_{label}_LensCap", 11, 12,
                 (x, y, ring_z + 25), "steel", vertices=10, bevel=1.0)
        box(f"PlaneNode_{label}_UpperRingPost", (10, 10, 42),
            (x, y, ring_z + 23), "steel", bevel=1.0)
        pack.research_diagonal_beam(
            collection, root, prefix + f"_PlaneNode_{label}_RadialBrace",
            (0, core_y, crown_base_z + 24),
            (x, y, ring_z - 10), 9, 11, mats["bronze"])
        kit.industrial_pipe_path(
            collection, root, prefix + f"_PlaneNode_{label}_PhaseConduit",
            [(0, core_y, crown_base_z + 26),
             (math.cos(angle) * 58, core_y + math.sin(angle) * 58,
              crown_base_z + 26),
             (x, y, crown_base_z + 38)],
            4.8, mats["bronze"])

    # Attached conduits visually link each archive wing into the central hub.
    for side in (-1, 1):
        label = "Left" if side < 0 else "Right"
        x = side * wing_x
        kit.industrial_pipe_path(
            collection, root, prefix + f"_{label}Wing_CoordinationConduit",
            [(x, wing_y + 52, floor_z + wing_h + 68),
             (side * 176, wing_y + 52, floor_z + wing_h + 68),
             (side * 176, core_y, core_top + 84),
             (side * (drum_radius - 12), core_y, core_top + 84)],
            7, mats["bronze"])

    # Wordless five-node hub emblem above the entrance.
    emblem_z = floor_z + entrance_h - 49
    box("HubEmblem_Backplate", (102, 8, 66),
        (0, entrance_front - 18, emblem_z), "steel", bevel=6.0)
    sphere("HubEmblem_Center", 7, (0, entrance_front - 24, emblem_z),
           "phase_glass", scale=(1.0, 0.55, 1.0))
    for index in range(5):
        angle = math.tau * index / 5 - math.pi / 2
        x = math.cos(angle) * 24
        z = emblem_z + math.sin(angle) * 24
        box(f"HubEmblem_Link_{index+1}", (3.2, 3.2, 22),
            (x / 2, entrance_front - 23, (z + emblem_z) / 2), "bronze",
            rotation=(0, math.degrees(angle) + 90, 0), bevel=0.4)
        sphere(f"HubEmblem_Node_{index+1}", 4.5,
               (x, entrance_front - 25, z), "bronze", scale=(1.0, 0.55, 1.0))

    root["asset_status"] = "model_candidate_v2_awaiting_user_review"
    root["building_family"] = "advanced_research"
    root["research_tier"] = 5
    root["footprint_cells"] = 4
    root["global_build_limit"] = 1
    root["logical_ground_projection"] = "512x256 pixels; calibrate final art independently"
    root["identity"] = (
        "unique six-storey interplane coordination core with two attached "
        "five-storey data wings and one detailed physically supported five-node crown")
    root["runtime_integration_active"] = False
    root["entry_axis"] = "local negative Y"
    return root


def spawn_custom_body_depth(manifest_path, building_id, blend_path,
                            preview_path, depth_path, body_depth_path):
    command = [
        bpy.app.binary_path,
        "--background",
        "--factory-startup",
        "--python",
        str(Path(__file__).resolve()),
        "--",
        manifest_path,
        building_id,
        blend_path,
        preview_path,
        depth_path,
        body_depth_path,
        "--body-only",
    ]
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise SystemExit(
            f"isolated body-depth render failed for {building_id}: "
            f"exit {completed.returncode}")


if __name__ == "__main__":
    pack.BUILDERS["interplane_research_hub"] = build_interplane_research_hub
    pack.spawn_saved_body_depth = spawn_custom_body_depth
    pack.main()
